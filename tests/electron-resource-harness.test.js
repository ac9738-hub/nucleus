const test = require('node:test')
const assert = require('node:assert/strict')
const { createElectronResourceHarness } = require('../lib/electron-resource-harness')

test('collect returns system, main, and electron sections', () => {
  const harness = createElectronResourceHarness()
  const mockApp = {
    getAppMetrics() {
      return [
        {
          pid: 100,
          type: 'Browser',
          cpu: { percentCPUUsage: 12.3 },
          memory: { workingSetSize: 80 * 1048576, peakWorkingSetSize: 90 * 1048576 }
        },
        {
          pid: 101,
          type: 'GPU',
          cpu: { percentCPUUsage: 4.1 },
          memory: { workingSetSize: 40 * 1048576, peakWorkingSetSize: 45 * 1048576 }
        }
      ]
    }
  }

  harness.collect(mockApp, { counts: { tabs: 3 } })
  const snapshot = harness.collect(mockApp, { counts: { tabs: 3 } })

  assert.ok(snapshot.sampledAt > 0)
  assert.ok(snapshot.system.totalMemMb > 0)
  assert.equal(snapshot.counts.tabs, 3)
  assert.equal(snapshot.electron.processCount, 2)
  assert.equal(snapshot.electron.topConsumers[0].type, 'Browser')
  assert.equal(snapshot.electron.byType.Browser.count, 1)
  assert.equal(snapshot.electron.totalWorkingSetMb, 120)
})
