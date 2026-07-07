"""Deploy and invoke Nucleus parse Lambda functions."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

LAMBDA_HANDLER = 'aws_lambda_parse.handler.handler'
DEFAULT_FUNCTION_NAME = 'nucleus-parse-item'
DEFAULT_RUNTIME = 'python3.12'
DEFAULT_TIMEOUT = 900
DEFAULT_MEMORY = 3008
DEFAULT_EPHEMERAL_MB = 10240
DEFAULT_INVOKE_WORKERS = 64
DEFAULT_RESERVED_CONCURRENCY = 100


@dataclass(frozen=True)
class LambdaWorkerState:
    region: str
    function_name: str
    bucket: str
    role_arn: str

    def to_dict(self) -> dict[str, str]:
        return {
            'region': self.region,
            'function_name': self.function_name,
            'bucket': self.bucket,
            'role_arn': self.role_arn,
            'kind': 'lambda',
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> LambdaWorkerState:
        return cls(
            region=str(data['region']),
            function_name=str(data['function_name']),
            bucket=str(data['bucket']),
            role_arn=str(data.get('role_arn') or ''),
        )


def state_path(root: Path) -> Path:
    return root / '.cache' / 'parse_trial' / 'lambda_worker.json'


def load_lambda_state(root: Path) -> LambdaWorkerState | None:
    path = state_path(root)
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding='utf-8'))
    if data.get('kind') != 'lambda':
        return None
    return LambdaWorkerState.from_dict(data)


def save_lambda_state(root: Path, state: LambdaWorkerState) -> Path:
    path = state_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state.to_dict(), indent=2), encoding='utf-8')
    return path


def _zip_paths(build_dir: Path, zip_path: Path, paths: list[Path]) -> None:
    with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for path in paths:
            if path.is_dir():
                for file in path.rglob('*'):
                    if file.is_file() and '__pycache__' not in file.parts:
                        archive.write(file, file.relative_to(build_dir).as_posix())
            elif path.is_file():
                archive.write(path, path.relative_to(build_dir).as_posix())


def _zip_unzipped_bytes(zip_path: Path) -> int:
    with zipfile.ZipFile(zip_path) as archive:
        return sum(info.file_size for info in archive.infolist())


_PRUNE_DIR_NAMES = frozenset({
    '__pycache__', 'tests', 'test', 'testing', 'docs', 'doc', 'examples', 'benchmarks',
})
_PRUNE_FILE_SUFFIXES = frozenset({'.pyc', '.pyo', '.c', '.h', '.pyi', '.a'})


def prune_lambda_tree(root: Path) -> None:
    for path in list(root.rglob('*')):
        if not path.exists():
            continue
        if path.is_dir():
            if path.name in _PRUNE_DIR_NAMES or path.suffix == '.dist-info':
                shutil.rmtree(path, ignore_errors=True)
        elif path.suffix in _PRUNE_FILE_SUFFIXES:
            path.unlink(missing_ok=True)


def _pip_install_lambda_deps(target: Path, req: Path) -> None:
    base_cmd = [
        sys.executable, '-m', 'pip', 'install',
        '-r', str(req),
        '-t', str(target),
        '--quiet', '--no-cache-dir',
    ]
    linux_cmd = [
        *base_cmd,
        '--platform', 'manylinux2014_x86_64',
        '--python-version', '3.12',
        '--implementation', 'cp',
        '--only-binary', ':all:',
    ]
    try:
        subprocess.run(linux_cmd, check=True)
    except subprocess.CalledProcessError:
        subprocess.run(base_cmd, check=True)


def _write_zip_from_dir(build_dir: Path, zip_path: Path) -> Path:
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for file in build_dir.rglob('*'):
            if file.is_file():
                archive.write(file, file.relative_to(build_dir).as_posix())
    return zip_path


def build_lambda_layer(root: Path) -> Path:
    cache_root = root / '.cache' / 'lambda_build'
    cache_root.mkdir(parents=True, exist_ok=True)
    build_dir = Path(tempfile.mkdtemp(prefix='layer-', dir=cache_root))
    python_dir = build_dir / 'python'
    python_dir.mkdir(parents=True)
    req = root / 'aws_lambda_parse' / 'requirements.txt'
    _pip_install_lambda_deps(python_dir, req)
    prune_lambda_tree(python_dir)
    zip_path = cache_root / 'nucleus-parse-layer.zip'
    _write_zip_from_dir(build_dir, zip_path)
    shutil.rmtree(build_dir, ignore_errors=True)
    return zip_path


def build_lambda_function_code(root: Path) -> Path:
    cache_root = root / '.cache' / 'lambda_build'
    cache_root.mkdir(parents=True, exist_ok=True)
    build_dir = Path(tempfile.mkdtemp(prefix='fn-', dir=cache_root))
    ignore = shutil.ignore_patterns('__pycache__', '*.pyc', '*.pyo', 'tests', 'test')
    shutil.copytree(root / 'canvas_parser', build_dir / 'canvas_parser', ignore=ignore)
    shutil.copy2(root / 'parser.py', build_dir / 'parser.py')
    shutil.copytree(root / 'aws_lambda_parse', build_dir / 'aws_lambda_parse', ignore=ignore)
    prune_lambda_tree(build_dir)
    zip_path = cache_root / 'nucleus-parse.zip'
    _write_zip_from_dir(build_dir, zip_path)
    shutil.rmtree(build_dir, ignore_errors=True)
    return zip_path


def build_lambda_package(root: Path) -> Path:
    """Build function code zip (deps go in Lambda layer)."""
    return build_lambda_function_code(root)


def publish_lambda_layer(
    lam,
    *,
    layer_name: str,
    zip_path: Path,
) -> str:
    with zip_path.open('rb') as body:
        response = lam.publish_layer_version(
            LayerName=layer_name,
            Description='Nucleus parse trial dependencies',
            Content={'ZipFile': body.read()},
            CompatibleRuntimes=[DEFAULT_RUNTIME],
        )
    return str(response['LayerVersionArn'])


def ensure_lambda_role(iam, function_name: str) -> str:
    role_name = f'{function_name}-role'[:64]
    trust = {
        'Version': '2012-10-17',
        'Statement': [{
            'Effect': 'Allow',
            'Principal': {'Service': 'lambda.amazonaws.com'},
            'Action': 'sts:AssumeRole',
        }],
    }
    try:
        role = iam.get_role(RoleName=role_name)
        return role['Role']['Arn']
    except iam.exceptions.NoSuchEntityException:
        role = iam.create_role(
            RoleName=role_name,
            AssumeRolePolicyDocument=json.dumps(trust),
        )
        iam.attach_role_policy(
            RoleName=role_name,
            PolicyArn='arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
        )
        time.sleep(10)
        return role['Role']['Arn']


def ensure_bucket(s3, bucket: str, region: str) -> None:
    try:
        s3.head_bucket(Bucket=bucket)
    except Exception:
        if region == 'us-east-1':
            s3.create_bucket(Bucket=bucket)
        else:
            s3.create_bucket(
                Bucket=bucket,
                CreateBucketConfiguration={'LocationConstraint': region},
            )


def deploy_lambda(
    root: Path,
    *,
    region: str,
    function_name: str,
    bucket: str,
    deepseek_key: str,
    canvas_cookie: str = '',
    canvas_base_url: str = '',
) -> LambdaWorkerState:
    import boto3

    zip_path = build_lambda_function_code(root)
    layer_zip = build_lambda_layer(root)
    zip_size = zip_path.stat().st_size
    layer_size = layer_zip.stat().st_size
    unzipped_total = _zip_unzipped_bytes(zip_path) + _zip_unzipped_bytes(layer_zip)
    if unzipped_total > 250 * 1024 * 1024:
        raise RuntimeError(
            f'Lambda package+layer unzipped {unzipped_total / 1024 / 1024:.1f}MB exceeds 250MB limit'
        )
    session = boto3.Session(region_name=region)
    iam = session.client('iam')
    lam = session.client('lambda')
    s3 = session.client('s3')
    sts = session.client('sts')
    account = sts.get_caller_identity()['Account']
    bucket_name = bucket or f'nucleus-parse-{account}-{region}'.lower()[:63]

    ensure_bucket(s3, bucket_name, region)
    role_arn = ensure_lambda_role(iam, function_name)

    env_vars = {'DEEP_SEEK_API_KEY': deepseek_key, 'NUCLEUS_PARSE_BUCKET': bucket_name}
    if canvas_cookie:
        env_vars['CANVAS_AUTH_COOKIE'] = canvas_cookie
    if canvas_base_url:
        env_vars['CANVAS_BASE_URL'] = canvas_base_url

    policy = {
        'Version': '2012-10-17',
        'Statement': [{
            'Effect': 'Allow',
            'Action': ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
            'Resource': [f'arn:aws:s3:::{bucket_name}', f'arn:aws:s3:::{bucket_name}/*'],
        }],
    }
    iam.put_role_policy(
        RoleName=role_arn.split('/')[-1],
        PolicyName='nucleus-parse-s3',
        PolicyDocument=json.dumps(policy),
    )

    with zip_path.open('rb') as body:
        zip_bytes = body.read()

    layer_name = f'{function_name}-deps'[:64]
    layer_arn = publish_lambda_layer(lam, layer_name=layer_name, zip_path=layer_zip)

    kwargs = {
        'FunctionName': function_name,
        'Runtime': DEFAULT_RUNTIME,
        'Role': role_arn,
        'Handler': LAMBDA_HANDLER,
        'Timeout': DEFAULT_TIMEOUT,
        'MemorySize': DEFAULT_MEMORY,
        'EphemeralStorage': {'Size': DEFAULT_EPHEMERAL_MB},
        'Environment': {'Variables': env_vars},
        'Architectures': ['x86_64'],
        'Layers': [layer_arn],
    }

    try:
        lam.get_function(FunctionName=function_name)
        if zip_size > 50 * 1024 * 1024:
            s3_key = f'deploy/{function_name}/{int(time.time())}.zip'
            s3.put_object(Bucket=bucket_name, Key=s3_key, Body=zip_bytes)
            _call_lambda_with_retry(
                lam,
                'update_function_code',
                FunctionName=function_name,
                S3Bucket=bucket_name,
                S3Key=s3_key,
            )
        else:
            _call_lambda_with_retry(
                lam, 'update_function_code', FunctionName=function_name, ZipFile=zip_bytes,
            )
        _wait_for_lambda_ready(lam, function_name)
        _call_lambda_with_retry(
            lam,
            'update_function_configuration',
            FunctionName=function_name,
            Timeout=DEFAULT_TIMEOUT,
            MemorySize=DEFAULT_MEMORY,
            EphemeralStorage={'Size': DEFAULT_EPHEMERAL_MB},
            Environment={'Variables': env_vars},
            Layers=[layer_arn],
        )
    except lam.exceptions.ResourceNotFoundException:
        if zip_size > 50 * 1024 * 1024:
            s3_key = f'deploy/{function_name}/{int(time.time())}.zip'
            s3.put_object(Bucket=bucket_name, Key=s3_key, Body=zip_bytes)
            kwargs['Code'] = {'S3Bucket': bucket_name, 'S3Key': s3_key}
        else:
            kwargs['Code'] = {'ZipFile': zip_bytes}
        lam.create_function(**kwargs)

    state = LambdaWorkerState(
        region=region,
        function_name=function_name,
        bucket=bucket_name,
        role_arn=role_arn,
    )
    concurrency = ensure_function_concurrency(lam, function_name)
    if concurrency.get('applied'):
        print(f'Lambda reserved concurrency: {concurrency["reserved"]}')
    elif concurrency.get('reason'):
        print(f'Lambda reserved concurrency not applied: {concurrency["reason"]}', file=sys.stderr)
    save_lambda_state(root, state)
    return state


def ensure_function_concurrency(
    lam,
    function_name: str,
    *,
    reserved: int | None = None,
) -> dict[str, Any]:
    """Reserve concurrent executions when the account pool allows it."""
    target = reserved
    if target is None:
        raw = os.getenv('PARSER_LAMBDA_RESERVED_CONCURRENCY', str(DEFAULT_RESERVED_CONCURRENCY))
        try:
            target = int(raw)
        except ValueError:
            target = DEFAULT_RESERVED_CONCURRENCY
    if target <= 0:
        return {'reserved': None, 'applied': False, 'reason': 'disabled'}

    account_limit = None
    try:
        account_limit = int(
            lam.get_account_settings().get('AccountLimit', {}).get('ConcurrentExecutions') or 0
        )
    except Exception:
        account_limit = None
    # AWS requires >=10 unreserved concurrent executions on the account.
    if account_limit and account_limit > 10:
        target = min(target, account_limit - 10)
    elif account_limit and account_limit <= 10:
        return {
            'reserved': target,
            'applied': False,
            'reason': (
                f'account ConcurrentExecutions={account_limit} (need quota increase before reserving; '
                'request raise via Service Quotas → Lambda concurrent executions)'
            ),
            'account_limit': account_limit,
        }
    if target <= 0:
        return {'reserved': 0, 'applied': False, 'reason': 'no headroom after unreserved minimum'}

    try:
        lam.put_function_concurrency(
            FunctionName=function_name,
            ReservedConcurrentExecutions=target,
        )
        return {'reserved': target, 'applied': True, 'account_limit': account_limit}
    except Exception as error:
        return {
            'reserved': target,
            'applied': False,
            'reason': str(error),
            'account_limit': account_limit,
        }


def get_function_concurrency(lam, function_name: str) -> dict[str, Any]:
    """Read reserved concurrency; None means account-shared (unreserved) pool."""
    try:
        response = lam.get_function_concurrency(FunctionName=function_name)
        return {
            'reserved': response.get('ReservedConcurrentExecutions'),
            'status': 'ok',
        }
    except lam.exceptions.ResourceNotFoundException:
        return {'reserved': None, 'status': 'unreserved'}
    except Exception as error:
        return {'reserved': None, 'status': 'error', 'reason': str(error)}


def _wait_for_lambda_ready(lam, function_name: str, *, timeout_sec: int = 180) -> None:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        response = lam.get_function(FunctionName=function_name)
        state = response.get('Configuration', {}).get('LastUpdateStatus', '')
        if state in {'', 'Successful'}:
            return
        if state == 'Failed':
            reason = response.get('Configuration', {}).get('LastUpdateStatusReason', 'unknown')
            raise RuntimeError(f'Lambda update failed: {reason}')
        time.sleep(3)
    raise TimeoutError(f'Timed out waiting for Lambda {function_name} to become ready')


def _call_lambda_with_retry(lam, method: str, *, retries: int = 12, delay_sec: float = 5.0, **kwargs) -> Any:
    operation = getattr(lam, method)
    for attempt in range(retries):
        try:
            return operation(**kwargs)
        except lam.exceptions.ResourceConflictException:
            if attempt + 1 >= retries:
                raise
            _wait_for_lambda_ready(lam, kwargs['FunctionName'], timeout_sec=int(delay_sec * 2))
            time.sleep(delay_sec)
    raise RuntimeError(f'Lambda {method} failed after {retries} retries')


def upload_course_seeds(
    s3_client,
    bucket: str,
    run_id: str,
    course_seeds: dict[str, dict[str, Any]],
) -> dict[str, str]:
    """Upload per-course seed graphs; return course_id → s3_key."""
    keys: dict[str, str] = {}
    for course_id, seed in course_seeds.items():
        if not seed:
            continue
        s3_key = f'runs/{run_id}/seeds/{course_id}.json'
        s3_client.put_object(
            Bucket=bucket,
            Key=s3_key,
            Body=json.dumps(seed, ensure_ascii=False).encode('utf-8'),
            ContentType='application/json',
        )
        keys[course_id] = s3_key
    return keys


def download_seed_from_s3(s3_client, bucket: str, s3_key: str) -> dict[str, Any]:
    obj = s3_client.get_object(Bucket=bucket, Key=s3_key)
    return json.loads(obj['Body'].read().decode('utf-8'))


def _build_invoke_payload(
    *,
    batch_type: str,
    item: dict[str, Any],
    key_suffix: str,
    bucket: str,
    run_id: str,
    placement: str,
    canvas_auth: dict[str, str] | None,
    production: bool,
    seed_state: dict[str, Any] | None,
    seed_by_item_key: dict[str, dict[str, Any]] | None,
    seed_s3_key_by_item: dict[str, str] | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        'placement': placement,
        'batch_type': batch_type,
        'item': item,
        'item_key': key_suffix,
        'bucket': bucket,
        'run_id': run_id,
        'production': bool(production),
    }
    if canvas_auth:
        payload['canvas_auth'] = canvas_auth
    seed_s3_key = (seed_s3_key_by_item or {}).get(key_suffix)
    if seed_s3_key:
        payload['seed_s3_key'] = seed_s3_key
    else:
        item_seed = (seed_by_item_key or {}).get(key_suffix)
        if item_seed is not None:
            payload['seed_state'] = item_seed
        elif seed_state is not None:
            payload['seed_state'] = seed_state
    return payload


def _invoke_one_event(lambda_client, function_name: str, payload: dict[str, Any]) -> None:
    lambda_client.invoke(
        FunctionName=function_name,
        InvocationType='Event',
        Payload=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
    )


def invoke_items_concurrent(
    lambda_client,
    function_name: str,
    *,
    bucket: str,
    run_id: str,
    items: list[tuple[str, dict[str, Any], str]],
    placement: str,
    canvas_auth: dict[str, str] | None = None,
    production: bool = False,
    seed_state: dict[str, Any] | None = None,
    seed_by_item_key: dict[str, dict[str, Any]] | None = None,
    seed_s3_key_by_item: dict[str, str] | None = None,
    max_workers: int | None = None,
    on_invoke_progress: Callable[[int, int], None] | None = None,
) -> None:
    """Queue one async (Event) invoke per item using a thread pool (not sequential boto3)."""
    if not items:
        return
    workers = max(1, max_workers or int(os.getenv('PARSER_LAMBDA_INVOKE_WORKERS', str(DEFAULT_INVOKE_WORKERS))))
    workers = min(workers, len(items))
    payloads = [
        _build_invoke_payload(
            batch_type=batch_type,
            item=item,
            key_suffix=key_suffix,
            bucket=bucket,
            run_id=run_id,
            placement=placement,
            canvas_auth=canvas_auth,
            production=production,
            seed_state=seed_state,
            seed_by_item_key=seed_by_item_key,
            seed_s3_key_by_item=seed_s3_key_by_item,
        )
        for batch_type, item, key_suffix in items
    ]
    total = len(payloads)
    queued = 0
    lock = threading.Lock()

    def _queue_one(payload: dict[str, Any]) -> None:
        nonlocal queued
        _invoke_one_event(lambda_client, function_name, payload)
        if on_invoke_progress:
            with lock:
                queued += 1
                on_invoke_progress(queued, total)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_queue_one, payload) for payload in payloads]
        for future in as_completed(futures):
            future.result()


def invoke_and_wait_s3_items(
    lambda_client,
    s3_client,
    function_name: str,
    *,
    bucket: str,
    run_id: str,
    items: list[tuple[str, dict[str, Any], str]],
    placement: str,
    canvas_auth: dict[str, str] | None = None,
    production: bool = False,
    seed_state: dict[str, Any] | None = None,
    seed_by_item_key: dict[str, dict[str, Any]] | None = None,
    seed_s3_key_by_item: dict[str, str] | None = None,
    timeout_sec: int = 3600,
    poll_sec: int = 5,
    on_progress: Callable[[int, int], None] | None = None,
    max_workers: int | None = None,
) -> list[str]:
    """Fire Event invokes in a background thread while polling S3 for completions."""
    invoke_error: list[BaseException] = []

    def _invoke() -> None:
        try:
            invoke_items_concurrent(
                lambda_client,
                function_name,
                bucket=bucket,
                run_id=run_id,
                items=items,
                placement=placement,
                canvas_auth=canvas_auth,
                production=production,
                seed_state=seed_state,
                seed_by_item_key=seed_by_item_key,
                seed_s3_key_by_item=seed_s3_key_by_item,
                max_workers=max_workers,
            )
        except BaseException as error:
            invoke_error.append(error)

    invoke_thread = threading.Thread(target=_invoke, name='lambda-invoke', daemon=True)
    invoke_thread.start()
    try:
        return wait_for_s3_items(
            s3_client,
            bucket,
            run_id,
            len(items),
            timeout_sec=timeout_sec,
            poll_sec=poll_sec,
            on_progress=on_progress,
        )
    finally:
        invoke_thread.join()
        if invoke_error:
            raise invoke_error[0]


def _list_s3_json_keys(s3_client, bucket: str, prefix: str) -> list[str]:
    """List all ``.json`` object keys under ``prefix``, paginating past the 1000-key limit."""
    keys: list[str] = []
    token: str | None = None
    while True:
        kwargs: dict[str, Any] = {'Bucket': bucket, 'Prefix': prefix, 'MaxKeys': 1000}
        if token:
            kwargs['ContinuationToken'] = token
        response = s3_client.list_objects_v2(**kwargs)
        keys.extend(
            row['Key']
            for row in response.get('Contents') or []
            if str(row.get('Key') or '').endswith('.json')
        )
        if not response.get('IsTruncated'):
            break
        token = response.get('NextContinuationToken')
    return keys


def wait_for_s3_items(
    s3_client,
    bucket: str,
    run_id: str,
    expected: int,
    *,
    timeout_sec: int = 3600,
    poll_sec: int = 5,
    on_progress=None,
) -> list[str]:
    prefix = f'runs/{run_id}/items/'
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        keys = _list_s3_json_keys(s3_client, bucket, prefix)
        if on_progress:
            on_progress(len(keys), expected)
        if len(keys) >= expected:
            return keys
        time.sleep(poll_sec)
    keys = _list_s3_json_keys(s3_client, bucket, prefix)
    raise TimeoutError(f'Timed out waiting for {expected} Lambda results; got {len(keys)}')


def download_fragments(s3_client, bucket: str, keys: list[str]) -> list[dict[str, Any]]:
    import json as json_mod

    fragments: list[dict[str, Any]] = []
    for key in keys:
        obj = s3_client.get_object(Bucket=bucket, Key=key)
        fragments.append(json_mod.loads(obj['Body'].read().decode('utf-8')))
    return fragments
