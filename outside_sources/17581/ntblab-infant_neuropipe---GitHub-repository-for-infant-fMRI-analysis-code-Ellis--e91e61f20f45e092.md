# ntblab/infant_neuropipe - GitHub repository for infant fMRI analysis code (Ellis et al. 2021)
- Root URL: https://github.com/ntblab/infant_neuropipe/tree/StatLearning
- Course ID: 17581
- Max link depth: 3
- Crawled at: 2026-06-10T03:06:16Z


---

## GitHub - ntblab/infant_neuropipe at StatLearning · GitHub

- Source URL: https://github.com/ntblab/infant_neuropipe/tree/StatLearning
- Crawl depth: 0

GitHub - ntblab/infant_neuropipe at StatLearning · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Appearance settings
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Appearance settings
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
ntblab
/
infant_neuropipe
Public
Notifications
You must be signed in to change notification settings
Fork
4
Star
13
Code
Issues
0
Pull requests
0
Actions
Projects
Security and quality
0
Insights
Additional navigation options
Code
Issues
Pull requests
Actions
Projects
Security and quality
Insights
ntblab/infant_neuropipe
StatLearning
BranchesTags
Go to file
Code
Open more actions menu
Folders and files
Name
Name
Last commit message
Last commit date
Latest commit
History
9 Commits
9 Commits
analysis
analysis
archive
archive
data
data
group
group
logs
logs
prototype
prototype
results
results
scripts
scripts
subjects
subjects
.gitignore
.gitignore
README.md
README.md
globals.sh
globals.sh
infant_neuropipe_tutorial.pdf
infant_neuropipe_tutorial.pdf
pipeline_functions.png
pipeline_functions.png
scaffold
scaffold
version.md
version.md
View all files
Repository files navigation
README
Development project analysis pipeline
V_1.2_SL
Although substantial advances have been made in analyzing adult fMRI data using automated pipelines (e.g., HCP, fmriprep) these procedures typically do not work with infant fMRI data. Infants have small brains which mean that alignment to standard is difficult and they have different motion properties which means adult protocols for dealing with motion are inappropriate. Complicating this further, every session with an infant can be unique and thus without proper infrastructure will require extreme efforts in order to process them.
In this repository you will find the analysis pipeline used by the Turk-Browne lab for analyzing developmental fMRI data. This semi-automated pipeline allows users to preprocess task-based infant fMRI data in a robust and efficient way that minimizes the amount of manual intervention needed. This code is based on neuropipe and extended to meet the specific needs of developmental data. Below, you will find a schematic overview of the analysis pipeline. To analyze a participant's data so that it is ready for experiment-specific analyses only a few functions, based on the color steps coded in the schematic, must be run. However, throughout there are some manual steps and a lot of checks for quality assurance. For a more thorough description of the steps involved, review the 'Running a participant' subsection. For a visual walkthrough of the procedure, refer to 'infant_neuropipe_tutorial.pdf'
This pipeline assumes that data was collected using the code in the experiment_menu repository. It is recommended that you use that code base in order to set up your data to be used here. It is also a great way for you to collect data with a participant population that involves unpredictable stopping, starting and switching of different experiments. However, the most important hooks between these two repositories is that you are able to easily make timing files (the 'Analysis_Timing' script outlined in Step 11 used in this pipeline assumes a certain structure of the experiment data in order to extract timing information). If you could generate your own timing file information then you could avoid using the experiment_menu system and still use this pipeline with some small tweaks.
Although this pipeline involves many manual steps, expert users can analyze a participant's dataset in approximately 2 hours. Compared some adult pipelines (e.g., fmriprep) this is long, however, dealing with the idiosyncratic nature of every infant session makes this a remarkably fast pipeline.
This code can and is used for analysis of adult fMRI data; however, that is mainly done for the sake of comparison to infants. Indeed, this pipeline is not optimized for the analysis of adult fMRI data but rather infant fMRI data. Parameters can be changed to adapt to whatever needs but note this background. Moreover, this code is adapted to the data formats of the experiment_menu; a different data collection procedure will require different parameters.
Because of the nature of the data collection this repository was designed for, this repository will make one folder within which many experiments can be housed. This is not to say that you couldn't make a new copy of this directory for every project/experiment you run; however, in our use case of collecting infant data this is inappropriate because each participant potentially contributes to several experiments. Hence, this tool provides infrastructure to house all of these experiments under one roof with common code and resources.
Expected background
This README and attached tutorial have been designed for intermediate to advanced fMRI users. In particular, it is expected that users will be familiar with bash, matlab and FSL. Indeed, throughout this repository there are many mentions to specific but commonly used scripts from these tools that will not be explained. It also helps to have completed the neuropipe and FSL tutorials.
Before starting to use the code in this repository it is recommended that you read through this README and then go through the tutorial. This tutorial is intended to repeat some of the content of the README but with supporting visual detail and additional considerations.
Setting up
To use this repository, first clone this data to the folder you want to store it. It is expected that you will store and run this code from a cluster; although it might be possible to do this just on a workstation.
This repo is set up to handle a number of different cluster environments but to suit your specific cluster it is necessary to make some changes for the initial set up.
Note: $SUBJ_DIR refers to the full path to the subject folder which contains participant specific data, whereas $PROJ_DIR is the root directory containing the whole project.
This repo has dependencies with FSL, FreeSurfer, AFNI, MATLAB, Python. BrainIAK is used for experiment-specific analyses but is not needed in the default pipeline. By default, these are loaded in as modules in the globals.sh script. To suit your cluster setup these should be changed and could be converted into something like a conda environment that you load in globals.sh.
In order to make the code here aware of where to find these dependencies, it is necessary for you to change the globals.sh file ($PROJ_DIR/prototype/link/global.sh). This file sets up all of the necessary path names and software that will be needed for any function called in the pipeline within bash. If you need to access these paths from matlab, $SUBJ_DIR/scripts/read_globals.m script pulls these paths. In globals.sh, near the top, is a section titled: "Things to change". In this, change all of the parameters so as to match what is appropriate for your cluster, environment and experiment. These lines may reference separate steps of the pipeline that are described below:
Specify how to load in all of the dependencies listed above.
Change PROJ_DIR to the path to your repo, change TR to the appropriate default TR duration of your functional data (in seconds. The code can handle differences in TR across participant/run but just choose a good default value), and the PACKAGES_DIR. The PACKAGES_DIR contains various functions that are necessary for this repo but can't be included for copyright reasons. These include:
moutlier1 - necessary for zipper detection in Step 5 (not enabled by default)
mrTools - necessary for manual alignment in Step 13
NIfTI_tools - necessary for loading in fMRI data for many steps
BIAC_Matlab_R2014a - necessary to convert dicom files to nifti as part of Step 1 but could otherwise be skipped
Finally, this pipeline is dependent on data such as brain atlases. The ATLAS_DIR variable should point to a folder including these two datasets:
nihpd_obj2_asym_nifti (Infant atlases)
nihpd_asym_all_nifti (Child atlases)
Analyzing a participant
This section describes describes what processing steps are performed on the anatomical and functional scans for the standard analysis pipeline of a single infant participant. The pipeline has been made to work flexibly with different parameters and can be adjusted to do more or less preprocessing as desired. Unless otherwise noted, all commands should be run within the subject folder ($SUBJ_DIR).
You will note that there are some matlab and python scripts used in this pipeline. To be compatible with cluster use, almost all of these scripts have a bash wrapper script that allows it to be submitted to the cluster. For instance, '$SUBJ_DIR/scripts/prep_raw_data.m' is a matlab script that has a wrapper script called: '$SUBJ_DIR/scripts/run_prep_raw_data.sh'. There should be a 'run_$matlab-script' for all of the scripts that ought to be run from the command line (i.e. scripts that aren't children of other scripts). These scripts set up the environment using globals.sh, hence why it is necessary to make the environment correctly.
As mentioned earlier, this code is set up for the specific-use case of analyzing infant data using the system the Turk-Browne lab has available. However, we believe that many of the tools we use here would be useful to others but require adaptation to suit their needs. We tried to write the code as general as possible to facilitate others adaptations but we couldn't be comprehensive. The hope is the following steps provide sufficient explanation of what needs to happen in order to know what you do and don't need to do. Moreover, each step includes instructions on how to skip it or otherwise create the necessary files so as not to diverge from the main pipeline.
Scaffold and retrieve data for a new participant using the initial NeuroPipe set up.
Scaffold, retrieve data and run prep_xnat.sh for a new participant, as described in the neuropipe tutorial. There are some differences in how this pipeline works compared to neuropipe but the most important concepts about neuropipe to understand are that for each new participant you 'scaffold' a new directory containing folders and files, some of which were directly 'copied' (so that changes are specific to that participant) and other files are 'linked' (so that changes affect all participants) and when you 're-scaffold' you add any new files that have been created for sharing but critically you DON'T overwrite any files that aren't linked.
You should also move the matlab file that was generated by the experiment_menu code into the '$SUBJ_DIR/data/Behavioral/' folder.
The prep_xnat.sh script creates the following naming structure: EPI=${SUBJ_NAME}_functionalXX.nii.gz, MPRAGE=${SUBJ_NAME}_mprageXX.nii.gz, PETRA=${SUBJ_NAME}_petraXX.nii.gz. If you have other scan types that you want to use then you can also store them but by default they won't be recognized. If they are anatomicals you would like to preprocess in Step 5 you can alter scripts/run_prep_raw_data.sh to recognize it.
If you have an alternative procedure for converting data from the scanner into niftis then do the following: scaffold the new participant directory, create a '$SUBJ_DIR/data/nifti' folder and copy your nifti files into there. To make them readable by the scripts, rename your nifti files with the above naming structure. Make sure they have already been oriented to the correct space (presumably LAS).
Add new participant information to the text file $PROJ_DIR/scripts/Participant_Data.txt
Add the three columns of information to this file: matlab file prefix (the name of the matlab file that is generated by experiment menu), fMRI file prefix (which is the same as $SUBJ_NAME), and the participant age (in months). This script is necessary for group analyses (e.g. figuring out who is in what age range) and for the code to link the appropriate brain atlas to a participant for registration. For your first participant, you will need to create this file.
If you don't have differences in age that you care about, you still want to create this file because helper functions use this information.
Mask the anatomicals to minimize influence from unwanted anatomical regions.
View anatomical images and check for unwanted anatomical regions such as the shoulders or neck. The default viewing tool used in this pipeline is FSLview, but you could use FSLeyes, Freeview or any other tool. Create a box (in voxel coordinates) around the desired region (fslmaths $Anatomical_unmasked -mul 0 -add 1 -roi $Xmin $Xlength $Ymin $Ylength $Zmin $Zlength 0 1 mask_01.nii.gz) and then apply that mask to the anatomical (make sure to use quotes) (fslmaths $Anatomical -mas mask_01.nii.gz ${Anatomical}_masked.nii.gz).
If you don't want to do masking but you want to benefit from the preprocessing in Step 5 then you should just make a duplicate of your original file and call it ${Anatomical}_masked.nii.gz. This naming is necessary for the code in Step 5 to identify which anatomical scans to further preprocess.
Prepare anatomicals for merging.
If there are multiple anatomical scans that could be aggregated in order to clean them up/reduce noise then you can merge them to improve the scan quality. If you only have one anatomical, or you don't think there would be a benefit of aggregating multiple scans then skip this step.
To do this, register the masked anatomicals to the highest quality scan (flirt -in $Low_quality_Scan -ref $High_quality_Scan -out ${Low_quality_Scan}_registered.nii.gz -dof 6). Rename the high quality scan to have a '_registered' suffix (cp $High_quality_Scan ${High_quality_Scan}_registered.nii.gz)
Run prep_raw_data to perform several functions of preprocessing.
Run the matlab script (sbatch scripts/run_prep_raw_data.sh) in order to do various preprocessing steps. Read this script in detail for more description of the preprocessing steps that were performed and how to change the default parameters used. This script determines the motion threshold for TR exclusions for the whole pipeline, as well as which time points will be used for registration. This script also does anatomical data cleaning (merging, unifizing, skull stripping) and gets the motion parameters.
If you only want to do a subset of steps in prep_raw_data you can specify them by providing different inputs to this function. For example: sbatch $SUBJ_DIR/scripts/run_prep_raw_data.sh [7,8,9] 3 2 mahal_threshold 0 would run steps 7 through 9 on functional run 3, assuming the burn in amount was 2 TRs and setting the threshold for the zipper detection to zero, eliminating this piece from the analysis. Assuming this step was run before Feat_firstlevel.sh (Step 12) then these changes would percolate through the analysis.
Code the eye tracking data and add these files to behavioral data directory.
In order to determine what functional data is usable, you might want to code the eyetracking data. This will help determine if there are TRs that may need to be excluded due to instances in which the participant was asleep or looking off-screen. Depending on the experiment, different types of gaze coding criteria can be specified. Scripts have been set up to code eye tracking data when collected using the experiment_menu code. The default is to assume that the eye tracking was collected via a frame grabber and thus needs to be manually coded. However, if EyeLink was used for data collection then eye tracking coding can be performed automatically using $SUBJ_DIR/scripts/Gaze_Categorization_EyeLink.m.
To code eye tracking data manually offline, there are scripts located in the Gaze_Categorization folder found in this project directory ($PROJ_DIR/scripts/Gaze_Categorization). The coding of video frames is run via $PROJ_DIR/scripts/Gaze_Categorization/scripts/Gaze_Categorization.m. When the data has been coded offline, add the files stored in $PROJ_DIR/scripts/Gaze_Categorization/Coder_Files/ to the participant's appropriate behavioral data directory in $SUBJ_DIR/data/Behavioral/. To set up either of these approaches for gaze coding, you may need to edit the script found in this main directory: $PROJ_DIR/scripts/Gaze_Categorization_Responses.m. For more information, read the README: $PROJ_DIR/scripts/Gaze_Categorization/README.md.
If you don't collect eye tracking data or don't code it then the code pipeline will still run and assume there are no exclusions due to eye tracking. That said, for some experiments like Posner, it will not produce any behavior related outputs or timing files.
Review the preprocessing of anatomicals and TRs identified as outliers.
There are several checks to do at this stage (after prep_raw_data has finished). First check that the anatomicals were preprocessed appropriately (e.g. that the merged brain is better than either brain individually). Then, review the TRs identified as outliers. In analysis/firstlevel/Confounds/Excluded_TRs_functional0*.nii.gz the data is the same original functional data except that TRs tagged for exclusion have a white border added, meaning you can watch the video of the TRs in fslview and see which TRs are excluded on the fly. Moreover, analysis/firstlevel/Confounds/Excluded_TRs_functional0*png contains the to-be-excluded TRs along with the preceding and following TRs. You can use firefox to view these (and other) png files.
Exclude runs as necessary.
If a run shouldn't be included (e.g., there are excessive TRs excluded for motion, it was only a few TRs long, no data was collected, they moved out of the field of view) then create a file named Excluded_Runs in the participant's Confounds folder (nano $SUBJ_DIR/analysis/firstlevel/Confounds/Excluded_Runs) and fill it with the run numbers to be excluded (e.g. "1 2 4"). These runs will not contribute to the total TR number you have as a result of Post-PreStats (Step 14). Note that you may need to return to this step after running Analysis_Timing.m in step 11.
Edit the mat file if necessary.
If there are errors in the mat file that need to be corrected (e.g. the code crashed halfway through an experiment and the TRs weren't collected, participant fell asleep but you didn't quit the block and you want to exclude it) then do so now. Copy the original mat file (cp $SUBJ_DIR/data/Behavioral/${{SUBJ_NAME}.mat $SUBJ_DIR/data/Behavioral/${SUBJ_NAME}_Original.mat), then create a script that converts this data to have the desired properties. Save the new mat data as "$SUBJ_DIR/data/Behavioral/${{SUBJ_NAME}.mat". If you choose to edit the mat file, it is necessary that the Mat_Data.m script thoroughly describes what you changed so you can traceback any alterations.
One kind of editing that is common is to remove triggers for runs that you may not want to include, potentially because they were calibration tests or were too short for use. Rather than having to exclude these TRs manually, you can create a file called $SUBJ_DIR/analysis/Behavioral/Analysis_Timing_TR_ignore.txt. In this, specify a time window (relative to the start of the menu) that you will exclude TRs between. This is a two-column file with each row as a window and the first column being the start (in seconds since experiment start) and the second column being the end (in seconds).
Create the FSF files.
Run $SUBJ_DIR/scripts/render-fsf-templates.sh. This makes assumptions about what the anatomical and standard reference will be: it assumes the anatomical will be '$SUBJ_DIR/data/$SUBJ_NAME_petra01.nii.gz' and the standard will be '$ATLAS_DIR/nihpd_obj2_asym_nifti/nihpd_asym_$AGE_RANGE_t1w.nii' ($AGE_RANGE is figured out using the information in $PROJ_DIR/scripts/Participant_Data.txt (Step 2). If you don't want to use these defaults you can supply the full path to the anatomical (first input) and standard (second input). For instance you may want to use the best anatomical image that you found when reviewing them (Step 7).
You can also provide a special suffix you want to save the name with (third input). For instance, if you want to generate a fsf file with a non-default smoothing parameter, you could provide '_smoothing_thresh0' as the third input to render-fsf-templates.sh to create an fsf file with smoothing equal to 0. These names can also be strung together (e.g. '_smoothing_thresh0_despiking1'). Finally, if you want to use a fsf file other than the default ($SUBJ_DIR/fsf/default.fsf.template) then you can provide this path instead. Different fsf files may have different parameters that can be changed and hence can allow for different types of feat analyses.
This step may be altered by the Analysis_Timing.m script (Step 11), specifically, if all of the blocks of a run are to be excluded then the run will also be excluded, and the fsf file will be renamed functional??_excluded_run.fsf
Create and check the timing files.
A matlab script has been made ($SUBJ_DIR/scripts/Analysis_Timing.m) which will automatically generate timing files for both first and second level analyses. This is a very important script and so is thoroughly documented in the README for analysis_timing: $SUBJ_DIR/scripts/Analysis_Timing_functions/README.md. Check to ensure that the TRs per run printed in this script are the same as the number of TRs for the functional runs (which will include rest). More thorough checks should see if all the TRs per block make sense (how many are listed as burn in for example), whether the timing of blocks is as expected and whether the eye tracking data is being appropriately excluded. A rigorous check would also include checking that the time between block onsets stored in the log file of the experiment (typically signaled by 'Experiment beginning, time: XXX') corresponds to the block onset times in the timing files at first level.
If the experiment you are using is not already in the analysis pipeline, you will need to add it. Read the instructions carefully for how to add the experiment to the pipeline. This should probably be run in matlab GUI using a tunnel or interactive session.
This script also deals with splitting data into pseudo-runs if more than one experiment is performed within a run. This will mean that new functional files are created and stored in $SUBJ_DIR/analysis/firstlevel/pseudoruns/ and the fsf files created in step 10 for the runs containing the pseudoruns. This will create a run name with a letter appended to the run number (e.g., functional01a, functional01b).
Note: you can re-run Analysis_Timing any time you wish to generate new timing files; however, it must be run before FunctionalSplitter (Step 15) or else these timing files will not percolate to the experiment specific directory
If you did not collect data using the experiment_menu code or your timing files are simple enough that you could generate them another way then you could skip this step (although in this case it is encouraged that you have alternative checks on your experiment timing then).
This code assumes it can accurately pull the participant's age from the timing file and use it to find an age appropriate standard.
Run FEAT_firstlevel.sh on each functional run.
To run FEAT, give the full path of the fsf file as an input into FEAT_firstlevel (e.g. sbatch $SUBJ_DIR/scripts/FEAT_firstlevel.sh $SUBJ_DIR/analysis/firstlevel/functional01.fsf). This will preprocess the data, doing smoothing, motion correction, detrending etc.; however, it does not perform any statistics. The preprocessed data will be passed on for subsequent analyses.
Several steps are performed in this pipeline that are unique to infant scanning that may or may not be appropriate in your use case. The list is as follows:
From prep_raw_data (Step 5) the TR that minimizes the distance between all other TRs is selected used for motion correction and registration. This can be turned off by default by editing the default value of 'useCentroidTR' at the top of prep_raw_data. It can be turned off for a single subject by running sbatch $SUBJ_DIR/scripts/run_prep_raw_data.sh [7,8,9] [1:100] $BURN_IN useCentroidTR 0
TRs that are excluded are interpolated before you do detrending so that they have minimal effect on analyses. Turn this feature off by specifying a suffix ('_interpolate0') as the third input to $SUBJ_DIR/scripts/render-fsf-templates.sh.
Use the SFNR values as the criteria for excluding brain and non-brain, rather than mean intensity. Turn this feature off by specifying a suffix ('_sfnrmask0') as the third input to $SUBJ_DIR/scripts/render-fsf-templates.sh.
Despiking is performed using the AFNI tool 3dDespike to remove any outlier TR timepoints. Turn this feature off by specifying a suffix ('_despiking0') as the third input to $SUBJ_DIR/scripts/render-fsf-templates.sh.
This script also integrates with manual_registration.sh such that if you are re-running a feat that already has been manually aligned (step 13), this will use that registration if it is still appropriate (i.e. if the reference TR has not changed).
It is possible to turn off any of these parameters individually by using the above commands or editing the fsf file, but if all wish to be removed and 'normal' feat is desirable, you can simply pass the fsf file to sbatch $SUBJ_DIR/scripts/run_feat.sh $fsf_file. This will use the normal feat pipeline and ignore any additional specifications (e.g. for MELODIC)
Perform manual alignment for the functional volume to the anatomical.
Look at the registration of the functional volume to high res, which was saved to the reg folder in the functional??.feat folder. The registration is likely to be bad with the non-optimal scans typical from awake infants. Improve the registration using the manual alignment function. To do the alignment for firstlevel, use the command: ./scripts/manual_registration.sh firstlevel_functional??. Perchance your registration is good; if so, this step can be ignored.
This script will ask whether you want to make a new registration (using some default settings of FLIRT) or use the registration that has been previously created. The latter means you can run this script iteratively to gradually improve the fit. It also asks whether you want to also include another functional run's alignment as an alternative reference for registration, so as to make it easier to align all functionals to one another. Finally, it is also possible to use the transformation matrix from another run if you think two runs have the brain in a similar position and you have already 'fixed' one of those brains. This script includes many instructions you should follow, especially for your first time.
The manual registration folder this script creates will be saved to $SUBJ_DIR/analysis/firstlevel/Manual_Reg/ when this is done. If/when FEAT_firstlevel.sh is run again, the manual registration you make may be used instead of the typical registration process if it is appropriate, meaning you don't have to do manual registration again. Note, this will only work if the example_funcs are the same across the two registrations; if they are different (e.g. you changed the motion threshold or the reference TR for instance) then you will need to do manual registration again.
Prepare first level functional data for second level.
Although your data has now been preprocessed within run, this pipeline aims to aggregate the data across runs and eventually to split it into separate 'runs' for the individual experiments. To start this, run sbatch ./scripts/Post-PreStats.sh to take first level functional data and create a second level space as if you collected all of your data in a single run. This involves many steps and in order to understand them you should thoroughly read the documentation of the script. The script takes all of the filtered functional data from the feat folders generated at the first level and then aligns them to the anatomical space (without up sampling the voxels). All of these functionals are then concatenated and masked appropriately. Finally, an attempt is made at aligning highres to standard and, by proxy, the functionals to standard.
Note: The file that is passed on is the filtered_func_data, not res4d (the residuals of the filtered func after the design matrix is applied). This means your motion parameters can change when at this step without you having to redo the previous steps.
This step is essential to allowing FunctionalSplitter (Step 15) to run. However, if you have a lot of data then this step may become unwieldy. Moreover, depending on how you want to do your analyses you might want to do second level analyses using FLAME or its ilk. In such cases, you probably don't want to run this script and will want to skip the next step (FunctionalSplitter). This being said, if you want to perform Steps 16-19 then you will need to create the ``$SUBJ_DIR/analysis/secondlevel/registration.feat/`, potentially by just copying a feat folder from first level (although depending on your between run alignment, mileage may vary. To check, look at the masks made by FEAT_Univariate (step 17)
Split the runs according to timing files.
Use sbatch ./scripts/run_FunctionalSplitter.sh to cleave the files such that each block, run and experiment are organized into NIFTI files. This also deals with balancing blocks between runs (when specified in code), zscoring runs and masking. To specify block balancing for a new experiment, you should create a script called: $SUBJ_DIR/scripts/FunctionalSplitter_functions/${ExperimentName}_Block_Balancing.m.
Check the registration to highres and to standard, and make changes if necessary.
The goal is to be able to convert from the concatenated space back to anatomical and standard space, so that you can map voxels onto the anatomical. Post-PreStats.sh should have generated a folder: $SUBJ_DIR/analysis/secondlevel/registration.feat. In this folder the highres to standard alignment for the first functional run is used as the baseline (it doesn’t matter if this run is noisier because all runs should have the same highres to standard alignment). Also, the new example_func2highres (trivial since they are already aligned) and example_func2standard (which is the same transformation as the highres2standard) are created. You should review these registrations and proceed if they look good. However, if they fail (as is likely with infants) there are three options:
If you think the issues are because of the standard brain (e.g., the standard isn't skull stripped and so your highres is the size of the skull, not the brain), use $SUBJ_DIR/scripts/register_secondlevel.sh $New_Standard to specify a new, appropriate standard
If the issue is with the high res image, perform more skull stripping on the highres you are using, and then only run the second half of this code. For severe skullstripping I recommend using bet2 from FSL and vary the -g parameter.
If you choose to use manual alignment, run the script ./scripts/manual_registration.sh secondlevel_standard . Note that you will need to select "1" when prompted to make a new baseline, since this has not yet been created. However, once this is run you can reload the previously generated baseline and iteratively tweak alignment to improve the fit.
If you needed to make these changes, once you have a good alignment to standard, you can then map your results into standard space using the appropriate registration: flirt -in analysis/secondlevel_${Experiment}/${AnalysisName}/${Functional} -applyxfm -init analysis/secondlevel/registration.feat/reg/example_func2standard.mat -out analysis/secondlevel_${Experiment}/${AnalysisName}/${Output} -ref analysis/secondlevel/registration.feat/reg/standard.nii.gz.
Run FEAT_univariate.sh
This step creates a task versus rest contrast for each run ignoring the different conditions or experiment differences. This is an optional step but can be useful for interrogating your effect size for each run. It also will run Analysis_DesignMotion which produces images showing the correlation between the experiment design on each run and the motion parameters---very useful when motion may be task correlated. Once all the feats have been made at first level, run this command from the participant's directory: sbatch $SUBJ\_DIR/scripts/FEAT\_univariate.sh. Files such as Motion_TaskCorrelation.png are outputted to: $SUBJ_DIR/analysis/firstlevel/Exploration/functional??_univariate.feat/.
Run run_FIR.sh
Perform FIR analyses on the data from each run to observe the shape of the evoked response. The function run_FIR.sh handles all of the necessary steps of this analysis; all that is needed is that the univariate folders be created (by FEAT_univariate.sh). Run sbatch $SUBJ_DIR/scripts/run_FIR.sh. This will then create all of the FIR directories and summary results that are useful. To view the main ones, use: firefox analysis/firstlevel/Exploration/functional??_fir.feat/Evoked_Response*.png. When you have run this on multiple participants with the same experiments, you can use $PROJ_DIR/scripts/Aggregate_FIR.sh to combine across participants
Review the participant.
For each step listed above it is important to review the log files and outputs that are generated. To help with this, especially with lots of participants, the jupyter notebook found at $SUBJ_DIR/analysis/participant_summary.ipynb has functions for getting summary information for each run and behavioral information. For instance, there are functions to show your motion properties, how many blocks you have, what the registration looks like, gaze coding results etc. This can help point out if anything went wrong along the way and can be rerun at any time to see how changes affect the new version of the data. Note, that these functions assume that you have completed all of the previous steps.
To open the notebook, one method involves running $SUBJ_DIR/scripts/launch_jupyter.sh. This creates a tunnel between your local computer and the cluster by generating a slurm job on a core which you can SSH on to from a different terminal window. You then point your browser to the localhost that was assigned to the tunnel. This is only one method of using jupyter notebooks and will likely require edits depending on your cluster set-up, if you have a different procedure then use that.
Perform second level analyses.
What you do here will depend on the experiment. For some experiments, it is typical to first perform 'statistics' in FEAT on the non-z scored data, then use this FEAT directory as a template for the Z score data (if you instead run FEAT on z scored data, the mask won't work because these volumes contain negative values and the masking function assumes all positive values). To run both the z scored and non z scored FEATs use: scripts/Feat_stats.sh $Template_FEAT $Output_FEAT $Input_functional. You may also use brainiak or other packages for conducting your higher level analyses.
Adding to repository
User feedback and input is always welcome! Please give us feedback. If you find bugs then make an issue on Github explaining the bug and how to replicate it.
If you have updates to the code you want to add then please follow the following steps:
On your private github account, fork this repo.
Clone said forked repo: git clone https://github.com/$USER/infant_neuropipe.git
Make your fork private if it isn't already. Do this on Github in settings
Set your forked repos' upstream to the public: git remote add upstream https://github.com/ntblab/infant_neuropipe.git
Make a branch for your update: git branch update_README
Move into branch: git checkout update_README
Add files to new branch
Git add and commit files: git add README.md; git commit -m "Update README"
Push changes to your branch: git push origin update_README
On github, initiate a pull request
Have the pull request reviewed
Contact us
If you have any questions or problems with the code the please reach out to us on Gitter. We are happy to help with bugs, questions and feature requests.
License
This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
You should have received a copy of the GNU General Public License along with this program. If not, see http://www.gnu.org/licenses/.
About
Neuropipe with specific scripts for analysing infant fMRI data collected with experiment_menu
Resources
Readme
Uh oh!
There was an error while loading. Please reload this page.
Activity
Custom properties
Stars
13
stars
Watchers
5
watching
Forks
4
forks
Report repository
Releases
2
v1.6-SubMem
Latest
Mar 5, 2025
+ 1 release
Packages
0
Uh oh!
There was an error while loading. Please reload this page.
Contributors
Uh oh!
There was an error while loading. Please reload this page.
Languages
MATLAB
70.0%
Shell
27.2%
Python
2.5%
Jupyter Notebook
0.3%
Footer
© 2026 GitHub, Inc.
Footer navigation
Terms
Privacy
Security
Status
Community
Docs
Contact
Manage cookies
Do not share my personal information
You can’t perform that action at this time.

### Links
- https://github.com/ntblab/infant_neuropipe/tree/StatLearning
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fntblab%2Finfant_neuropipe%2Ftree%2FStatLearning
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights

---

## GitHub · Change is constant. GitHub keeps you ahead. · GitHub

- Source URL: https://github.com/
- Crawl depth: 1

GitHub · Change is constant. GitHub keeps you ahead. · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
The future of building happens together
Tools and trends evolve, but collaboration endures. With GitHub, developers, agents, and code come together on one platform.
Enter your email
Sign up for GitHub
Try GitHub Copilot
GitHub features
A demonstration animation of a code editor using GitHub Copilot Chat, where the user requests GitHub Copilot to refactor duplicated logic and extract it into a reusable function for a given code snippet.
CodePlanCollaborateAutomateSecure
Code
Write, test, and fix code quickly with GitHub Copilot, from simple boilerplate to complex features.
GitHub customers
Accelerate your entire workflow
From your first line of code to final deployment, GitHub provides AI and automation tools to help you build and ship better software faster.
A Copilot chat window with the 'Ask' mode enabled. The user switches from 'Ask' mode to 'Agent' mode from a dropdown menu, then sends the prompt 'Update the website to allow searching for running races by name.' Copilot analyzes the codebase, then explains the required edits for three files before generating them. Copilot then confirms completion and summarizes the implemented changes for the new functionality allowing users to search races by name and view paginated, filtered results.
Your AI partner everywhere. Copilot is ready to work with you at each step of the software development lifecycle.
Explore GitHub Copilot
Duolingo boosts developer speed by 25% with GitHub Copilot
Read customer story
2025 Gartner® Magic Quadrant™ for AI Code Assistants
Read industry report
Automate your path to production
Ship faster with secure, reliable CI/CD.
Explore GitHub Actions
Code instantly from anywhere
Launch a full, cloud-based development environment in seconds.
Explore GitHub Codespaces
Keep momentum on the go
Manage projects and assign tasks to Copilot, all from your mobile device.
Explore GitHub Mobile
Shape your toolchain
Extend your stack with apps, actions, and AI models.
Explore GitHub Marketplace
Built-in application security where found means fixed
Use AI to find and fix vulnerabilities so your team can ship more secure software faster.
Apply fixes in seconds. Spend less time debugging and more time building features with Copilot Autofix.
Explore GitHub Advanced Security
Security debt, solved. Leverage security campaigns and Copilot Autofix to reduce application vulnerabilities.
Learn about GitHub Code Security
Dependencies you can depend on. Update vulnerable dependencies with supported fixes for breaking changes.
Learn about Dependabot
Your secrets, your business. Detect, prevent, and remediate leaked secrets across your organization.
Learn about GitHub Secret Protection
70% MTTR reduction with Copilot Autofix
8.3M secret leaks stopped in the past 12 months with push protection
Work together, achieve more
From planning and discussion to code review, GitHub keeps your team’s conversation and context next to your code.
Plan with clarity. Organize everything from high-level roadmaps to everyday tasks.
Explore GitHub Projects
“
It helps us onboard new software engineers and get them productive right away. We have all our source code, issues, and pull requests in one place... GitHub is a complete platform that frees us from menial tasks and enables us to do our best work.
Fabian FaulhaberApplication manager at Mercedes-Benz
Keep track of your tasks
Create issues and manage projects with tools that adapt to your code.
Explore GitHub Issues
Share ideas and ask questions
Create space for open-ended conversations alongside your project.
Explore GitHub Discussions
Review code changes together
Assign initial reviews to Copilot for greater speed and quality.
Explore code review
Fund open source projects
Become an open source partner and support the tools and libraries that power your work.
Explore GitHub Sponsors
From startups to enterprises, GitHub scales with teams of any size in any industry.
By industryBy sizeBy use case
By industry
Technology
Figma streamlines development and strengthens security
Read customer story
Automotive
Mercedes-Benz standardizes source code and automates onboarding
Read customer story
Financial services
Mercado Libre cuts coding time by 50%
Read customer story
Explore customer stories
View all solutions
Millions of developers and businesses call GitHub home
Whether you’re scaling your development process or just learning how to code, GitHub is where you belong. Join the world’s most widely adopted developer platform to build the technologies that shape what’s next.
Enter your email
Sign up for GitHub
Try GitHub Copilot
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/
- https://github.com/login
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## Sign in to GitHub · GitHub

- Source URL: https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fntblab%2Finfant_neuropipe%2Ftree%2FStatLearning
- Crawl depth: 1

Sign in to GitHub · GitHub
Skip to content
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
Sign in to GitHub
{{ message }}
Username or email address
Password
Forgot password?
Uh oh!
There was an error while loading. Please reload this page.
New to GitHub?
Create an account
Sign in with a passkey
Terms
Privacy
Docs
Contact GitHub Support
Manage cookies
Do not share my personal information
You can’t perform that action at this time.

### Links
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fntblab%2Finfant_neuropipe%2Ftree%2FStatLearning
- https://github.com/password_reset
- https://github.com/signup?return_to=https%3A%2F%2Fgithub.com%2Fntblab%2Finfant_neuropipe%2Ftree%2FStatLearning&source=login

---

## GitHub Copilot · Your AI pair programmer · GitHub

- Source URL: https://github.com/features/copilot
- Crawl depth: 1

GitHub Copilot · Your AI pair programmer · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
AI
GitHub Copilot
Copilot in VS Code
Agents on GitHub
Copilot CLI
For Business
Tutorials
Plans & Pricing
GitHub Copilot
Command your craft
Your AI accelerator for every workflow, from the editor to the enterprise.
Get startedSee plans & pricing
Pause
Companies using Copilot
Go beyond one-size-fits-all
Choose from leading LLMs optimized for speed, accuracy, or cost.
Use your agents, your way
Use GitHub Copilot, your own custom agents, or the third-party ones you already rely on.
Stay in your flow
Copilot works where you do—in GitHub, your IDE, project tools, chat apps, and custom MCP servers.
Workflow
Code, command, and collaborate
AI that works where you do, whether in your editor, on the command line, or across GitHub.
Make your editor your most powerful accelerator
Copilot in your editor does it all, from explaining concepts and completing code, to proposing edits and validating files with agent mode.
Explore Copilot in the IDE
Ship faster with AI that work alongside you
Assign tasks to agents like Copilot, Claude by Anthropic, and OpenAI Codex, and let them plan, explore, and execute work autonomously in the background.
Explore Copilot cloud agent
Bring AI to your terminal workflow
Direct Copilot in the terminal using natural language and watch it plan, build, and execute complex workflows powered by your GitHub context.
Explore GitHub Copilot CLI
Grupo Boticário increases developer productivity by 94% with Copilot
Read customer story
Tailor-made for your organization
Shape Copilot to your business needs. Customize what it knows, how it acts, and where it connects.
Turn Copilot into a project expert
Scale knowledge and keep teams consistent by creating a shared source of truth that includes context from your docs and repositories.
Try Copilot Spaces
Manage agent usage with enterprise-grade controls
Track activity with detailed audit logs and enforce governance by managing agents from a single control plane.
Read the docs
Secure your MCP integrations
Control which MCP servers developers can access from their IDEs, and use allow lists to prevent unauthorized access.
Read the docs
Plans
Take flight with GitHub Copilot
For individualsFor businesses
Free
For getting started with GitHub Copilot.
$0USD
Get startedOpen in VS Code
What's included:
2,000 completions per month
Access to Haiku 4.5, GPT-5 mini, and more
Copilot CLI
No credit card required. Verified students have access to the GitHub Copilot Student plan. Learn more
Pro
For everyday coding with agents in GitHub Copilot.
$10USDper user / month
New plan sign-ups are temporarily paused as we ensure a high-quality experience. We appreciate your patience. Learn more
Everything in Free and:
Access to Cloud agent and code review
Unlimited code completion and next edit suggestions
Access to 3rd party agents (Claude Code and Codex)
Model selection
$15 monthly total credits for Pro
Pro+
For more complex development with premium models.
$39USDper user / month
New plan sign-ups are temporarily paused as we ensure a high-quality experience. Existing Student and Pro customers can upgrade to Pro+. We appreciate your patience. Learn more
Everything in Pro and:
Access to premium models, including Opus
Audit logs
4x+ included usage than Pro
$70 monthly total credits for Pro+
Max
For sustained, high-volume agent workflows with GitHub Copilot.
$100USDper user / month
New plan sign-ups are temporarily paused as we ensure a high-quality experience. Existing Student, Pro, and Pro+ customers can upgrade to Max. We appreciate your patience. Learn more
Everything in Pro+ and:
Priority access to new models and features
2.9x+ included usage than Pro+
$200 monthly total credits for Max
Best value
GitHub Copilot is available on your favorite platforms:
GitHub
GitHub
VS Code
VS Code
Visual Studio
Visual Studio
Xcode
Xcode
JetBrains IDEs
JetBrains IDEs
Neovim
Neovim
Eclipse
Eclipse
Raycast
Raycast
SQL Server Management Studio
SQL Server Management Studio
Zed
Zed
Compare all plan features
Get the most out of GitHub Copilot
Preview the latest features
Be the first to explore what’s next for GitHub Copilot.
See previews
Explore the GitHub Blog
Discover the latest in software development with insights, best practices, and more.
Read Blog
Visit the GitHub Copilot Trust Center
Gain peace of mind with our security, privacy, and responsible AI policies.
Go to Trust Center
Frequently asked questions
General
What is GitHub Copilot?
GitHub Copilot transforms the developer experience. Backed by the leaders in AI, GitHub Copilot provides contextualized assistance throughout the software development lifecycle, from inline suggestions and chat assistance in the IDE to code explanations and answers to docs in GitHub and more. With GitHub Copilot elevating their workflow, developers can focus on: value, innovation, and happiness.
GitHub Copilot enables developers to focus more energy on problem solving and collaboration and spend less effort on the mundane and boilerplate. That’s why developers who use GitHub Copilot report up to 75% higher satisfaction with their jobs than those who don’t and are up to 55% more productive at writing code without sacrifice to quality, which all adds up to engaged developers shipping great software faster.
GitHub Copilot integrates with leading editors, including Visual Studio Code, Visual Studio, JetBrains IDEs, and Neovim, and, unlike other AI coding assistants, is natively built into GitHub. Growing to millions of individual users and tens of thousands of business customers, GitHub Copilot is the world’s most widely adopted AI developer tool and the competitive advantage developers ask for by name.
Who is eligible to access GitHub Copilot for free?
GitHub Copilot Free is a new free pricing tier with limited functionality for individual developers. Users assigned a Copilot Business or Copilot Enterprise seat are not eligible for access. Users with access to Copilot Pro through a paid subscription, trial, or through an existing verified OSS, student, faculty, or MVP account may elect to use Free instead.
What languages, IDEs, and platforms does GitHub Copilot support?
GitHub Copilot is trained on all languages that appear in public repositories. For each language, the quality of suggestions you receive may depend on the volume and diversity of training data for that language. For example, JavaScript is well-represented in public repositories and is one of GitHub Copilot’s best supported languages. Languages with less representation in public repositories may produce fewer or less robust suggestions.
GitHub Copilot is available as an extension in Visual Studio Code, Visual Studio, Vim, Neovim, the JetBrains suite of IDEs, and Azure Data Studio. Although inline suggestion functionality is available across all these extensions, chat functionality is currently available only in Visual Studio Code, JetBrains, and Visual Studio. GitHub Copilot is also supported in terminals through GitHub CLI and as a chat integration in Windows Terminal Canary. With the GitHub Copilot Enterprise plan, GitHub Copilot is natively integrated into GitHub.com. All plans are supported in GitHub Copilot in GitHub Mobile. GitHub Mobile for Copilot Pro and Copilot Business have access to Bing and public repository code search. Copilot Enterprise in GitHub Mobile gives you additional access to your organization's knowledge.
Does GitHub Copilot “copy/paste”?
No, GitHub Copilot generates suggestions using probabilistic determination.
When thinking about intellectual property and open source issues, it is critical to understand how GitHub Copilot really works. The AI models that create GitHub Copilot’s suggestions may be trained on public code, but do not contain any code. When they generate a suggestion, they are not “copying and pasting” from any codebase.
To generate a code suggestion, the GitHub Copilot extension begins by examining the code in your editor—focusing on the lines just before and after your cursor, but also information including other files open in your editor and the URLs of repositories or file paths to identify relevant context. That information is sent to GitHub Copilot’s model, to make a probabilistic determination of what is likely to come next and generate suggestions.
To generate a suggestion for chat in the code editor, the GitHub Copilot extension creates a contextual prompt by combining your prompt with additional context including the code file open in your active document, your code selection, and general workspace information, such as frameworks, languages, and dependencies. That information is sent to GitHub Copilot’s model, to make a probabilistic determination of what is likely to come next and generate suggestions.
To generate a suggestion for chat on GitHub.com, such as providing an answer to a question from your chat prompt, GitHub Copilot creates a contextual prompt by combining your prompt with additional context including previous prompts, the open pages on GitHub.com as well as retrieved context from your codebase or Bing search. That information is sent to GitHub Copilot’s model, to make a probabilistic determination of what is likely to come next and generate suggestions.
What are the differences between the GitHub Copilot Business, GitHub Copilot Enterprise, and GitHub Copilot Individual plans?
GitHub Copilot has multiple offerings for organizations and an offering for individual developers. All the offerings include both inline suggestion and chat assistance. The primary differences between the organization offerings and the individual offering are license management, policy management, and IP indemnity.
Organizations can choose between GitHub Copilot Business and GitHub Copilot Enterprise. GitHub Copilot Business primarily features GitHub Copilot in the coding environment - that is the IDE, CLI and GitHub Mobile. GitHub Copilot Enterprise includes everything in GitHub Copilot Business. It also  adds an additional layer of customization for organizations and integrates into GitHub.com as a chat interface to allow developers to converse with GitHub Copilot throughout the platform. GitHub Copilot Enterprise can index an organization’s codebase for a deeper understanding of the customer’s knowledge for more tailored suggestions and will offer customers access to fine-tuned custom, private models for inline suggestions.
GitHub Copilot Individual is designed for individual developers, freelancers, students, educators, and open source maintainers. The plan includes all the features of GitHub Copilot Business except organizational license management, policy management, and IP indemnity.
What data has GitHub Copilot been trained on?
GitHub Copilot is powered by generative AI models developed by GitHub, OpenAI, and Microsoft. It has been trained on natural language text and source code from publicly available sources, including code in public repositories on GitHub. Starting on April 24, GitHub may also use interactions from users with a Copilot Free, Copilot Pro, and Copilot Pro+ subscription - including inputs, outputs, code snippets, and associated context - to train and improve our AI models unless they have opted out. This allows us to build more intelligent, context-aware coding assistance for a more diverse set of coding tasks based on real-world development patterns. Users were notified 30 days before the change went into effect and can opt out from allowing their data to be used for training in their GitHub account settings at any time.
Which plan includes GitHub Copilot Autofix?
GitHub Copilot Autofix provides contextual explanations and code suggestions to help developers fix vulnerabilities in code, and is included in GitHub Advanced Security.
What if I do not want GitHub Copilot?
GitHub Copilot is entirely optional and requires you to opt in before gaining access. You can easily configure its usage directly in the editor, enabling or disabling it at any time. Additionally, you have control over which file types GitHub Copilot is active for.
How do I control access to GitHub Copilot in my company?
Access to Copilot Business and Enterprise is managed by your GitHub Administrator. They can control access to preview features, models, and set GitHub Copilot policies for your organization. Additionally, you can use your network firewall to explicitly allow access to Copilot Business and/or block access to Copilot Pro or Free. For more details, refer to the documentation.
Plans & pricing
What are the differences between the Free, Pro, Pro+, Max, Business, and Enterprise plans?
GitHub Copilot has multiple offerings for organizations and an offering for individual developers. All the offerings include both code completion and chat assistance. The primary differences between the organization offerings and the individual offering are license management, policy management, and IP indemnity.
Organizations can choose between GitHub Copilot Business and GitHub Copilot Enterprise. GitHub Copilot Business primarily features GitHub Copilot in the coding environment - that is the IDE, CLI and GitHub Mobile. GitHub Copilot Enterprise includes everything in GitHub Copilot Business. It also  adds an additional layer of customization for organizations and integrates into GitHub.com as a chat interface to allow developers to converse with Copilot  throughout the platform. GitHub Copilot Enterprise can index an organization’s codebase for a deeper understanding of the customer’s knowledge for more tailored suggestions and will offer customers access to fine-tuned custom, private models for code completion.
GitHub Copilot Pro is designed for individual developers, freelancers, students, educators, and open source maintainers. The plan includes all the features of GitHub Copilot Business except organizational license management, policy management, and IP indemnity.
GitHub Copilot Max is built for heavy Copilot usage, including sustained agent-driven workflows, and includes $100/month in GitHub AI Credits.
How can I upgrade my GitHub Copilot Free license to Copilot Pro?
If you're on the Free plan, you can upgrade to Pro through your Copilot settings page or directly on the Copilot marketing page.
What is included in GitHub Copilot Free?
GitHub Copilot Free users are limited to 2000 completions and 50 chat requests (including Copilot Edits).
Which plan includes GitHub Copilot Autofix?
GitHub Copilot Autofix provides contextual explanations and code suggestions to help developers fix vulnerabilities in code, and is included in GitHub Advanced Security and available to all public repositories.
Can users in my organization use Copilot code reviews for their pull requests if they don’t have a Copilot license?
Organizations can now enable Copilot code review on all pull requests on github.com—including pull requests from users who are not assigned a Copilot license.
This allows you to extend the quality and rich analysis of Copilot code review to all pull requests, regardless of its author, giving you complete coverage and confidence that pull requests have been reviewed.
To enable this functionality, an enterprise/org admin must first have Copilot enabled and then enabled two policies.
Note: This capability is not supported for Copilot code reviews in VS Code or other IDEs.
How does billing work for Copilot code review usage generated by users without a Copilot license?
Usage from non-licensed users is billed directly to your organization as GitHub AI Credits. This flexible model allows you to get full review coverage on every PR without purchasing a full Copilot seat for non-development contributors who may not need Copilot.
Usage from your existing licensed users continues to draw from their included monthly allowance as it does today. Beginning June 1, 2026, code review workflows also consume GitHub Actions minutes.
Is Copilot code review usage from users without a Copilot license enabled by default? How do I control the cost?
No. This capability is off by default and gives the enterprise admin control to enable or disable. An admin must explicitly enable two separate policies to activate:
‘GitHub AI Credits paid usage’ must be enabled to allow enterprises to be charged for GitHub AI Credits exceeding their included usage.
A new Copilot code review policy (‘Allow members without a Copilot license to use Copilot code review in github.com’) must also be enabled.
We encourage admins to set up budgets to control spending on our metered products, especially customers who have not enabled the ‘Premium request paid usage’ policy in the past. You can track all premium request usage in your billing dashboard to monitor and control spending.
What are GitHub AI Credits?
GitHub AI Credits are how you pay for AI usage in GitHub Copilot. Every plan includes a monthly allowance: 1 AI credit = $0.01 USD.
You use credits when you chat with Copilot, work with agents, or use Copilot CLI, Spaces, and Spark. Code completions and next edit suggestions don't use credits. They remain unlimited with every paid plan.
How many credits an interaction uses depends on the model you choose and the complexity of the task. A quick question to a lightweight model costs a fraction of a credit. A longer agent session on a frontier model across many files costs more.
What happens when I hit my usage limit?
When you've used your monthly allowance, you have a few options:
Wait for your next cycle. Your included allowance resets every month.
Keep working with paid usage. Set a dollar budget for additional usage and Copilot continues without interruption. Credits draw down at $0.01 each, so a $10 budget covers 1,000 credits.
Switch to a less expensive model. Lightweight models use fewer credits per interaction and stretch your remaining allowance further.
On GitHub Copilot Business and GitHub Copilot Enterprise, admins set usage limits and decide whether additional paid usage is allowed. If it isn't, Copilot pauses until the next cycle.
You can track your usage and reset date in your Copilot settings, with alerts at 75%, 90%, and 100% of any configured budget.
Privacy
What personal data does GitHub Copilot process?
GitHub Copilot processes personal data based on how Copilot is accessed and used: whether via GitHub.com, mobile app, extensions, or one of various IDE extensions, or through features like suggestions for the command line interface (CLI), IDE code completions, or personalized chat on GitHub.com. The types of personal data processed may include:
User Engagement Data: This includes pseudonymous identifiers captured on user interactions with Copilot, such as accepted or dismissed completions, error messages, system logs, and product usage metrics.
Prompts: These are inputs for chat or code, along with context, sent to Copilot's AI to generate suggestions.
Suggestions: These are the AI-generated code lines or chat responses provided to users based on their prompts.
Feedback Data: This comprises real-time user feedback, including reactions (e.g., thumbs up/down) and optional comments, along with feedback from support tickets.
Does GitHub use Copilot Business or Enterprise data to train GitHub’s model?
No. GitHub does not use either Copilot Business or Enterprise data to train its models.
How does GitHub use the Copilot data from Business and Enterprise Subscribers?
How GitHub uses Copilot data depends on how the user accesses Copilot and for what purpose. Users can access GitHub Copilot through the web, extensions, mobile apps, computer terminal, and various IDEs (Integrated Development Environments). GitHub generally uses personal data to:
Deliver, maintain, and update the services as per the customer's configuration and usage, to ensure personalized experiences and recommendations
Troubleshoot, which involves preventing, detecting, resolving, and mitigating issues, including security incidents and product-related problems, by fixing software bugs and maintaining the online services' functionality and up-to-dateness
Enhance user productivity, reliability, effectiveness, quality, privacy, accessibility, and security by keeping the service current and operational
These practices are outlined in GitHub’s Data Protection Agreement (DPA), which details our data handling commitments to our data controller customers. GitHub also uses certain personal data with customer authorization under the DPA, for the following purposes:
Billing and account management
To comply with and resolve legal obligations
For abuse detection, prevention, and protection, virus scanning, and scanning to detect violations of terms of service
To generate summary reports for calculating employee commissions and partner incentives
To produce aggregated reports for internal use and strategic planning, covering areas like forecasting, revenue analysis, capacity planning, and product strategy.
How does GitHub use the Copilot data from Individual (Free/Pro/Pro+) Subscribers?
GitHub uses the Copilot data from Individual subscribers for all the operational purposes described above for Business/Enterprise subscribers.
In addition, for Individual subscribers only: GitHub may use Copilot interaction data — including prompts (inputs), suggestions (outputs), and code snippets generated during Copilot sessions — to train and improve AI models. This training helps improve code suggestions for all Copilot users.
Individual subscribers can opt out of having their data used for AI model training at any time through https://github.com/settings/copilot/features. Opting out does not affect your access to Copilot features.
For details on GitHub's data processing activities as a controller, particularly for Copilot Free, Copilot Pro, and Copilot Pro customers, refer to the GitHub Terms of Service and the GitHub Privacy Statement.
How long does GitHub retain Copilot data for Business and Enterprise customers?
If and for how long GitHub’s retains Copilot data depends on how a Copilot user accesses Copilot and for what purpose. The default settings for Copilot Business and Enterprise Customers are as follows:
Access through IDE for Chat and Code Completions:
Prompts and Suggestions: Not retained
User Engagement Data: Kept for two years.
Feedback Data: Stored for as long as needed for its intended purpose.
All other GitHub Copilot access and use:
Prompts and Suggestions: Retained for 28 days.
User Engagement Data: Kept for two years.
Feedback Data: Stored for as long as needed for its intended purpose.
Why do some Copilot features retain prompts and suggestions?
Retaining prompts and suggestions is necessary for chat on github.com, mobile, and CLI Copilot because those features’ effectiveness depends on using thread history to improve responses. The Copilot model requires access to previous interactions to deliver accurate and relevant suggestions.
Does GitHub Copilot support compliance with the GDPR and other data protection laws?
Yes. GitHub and customers can enter a Data Protection Agreement that supports compliance with the GDPR and similar legislation.
Does GitHub Copilot ever output personal data?
While we've designed GitHub Copilot with privacy in mind, the expansive definition of personal data under legislation like the EU’s General Data Protection Regulation (GDPR) means we can't guarantee it will never output such data. The Large Language Model (LLM) powering GitHub Copilot was trained on public code and there were instances in our tests where the tool made suggestions resembling personal data. These suggestions were typically synthesized and not tied to real individuals.
How does Copilot allow users to access, alter or delete personal data?
These actions are available to Copilot users as described in the GitHub Privacy Statement.
Responsible AI
What are the intellectual property considerations when using GitHub Copilot?
The primary IP considerations for GitHub Copilot relate to copyright. The model that powers Copilot is trained on a broad collection of publicly accessible code, which may include copyrighted code, and Copilot’s suggestions (in rare instances) may resemble the code its model was trained on. Here’s some basic information you should know about these considerations:
Copyright law permits the use of copyrighted works to train AI models:  Countries around the world have provisions in their copyright laws that enable machines to learn, understand, extract patterns, and facts from copyrighted materials, including software code. For example, the European Union, Japan, and Singapore, have express provisions permitting machine learning to develop AI models. Other countries including Canada, India, and the United States also permit such training under their fair use/fair dealing provisions. GitHub Copilot’s AI model was trained with the use of code from GitHub’s public repositories—which are publicly accessible and within the scope of permissible copyright use.
What about copyright risk in suggestions? In rare instances (less than 1% based on GitHub’s research), suggestions from GitHub may match examples of code used to train GitHub’s AI model. Again, Copilot does not “look up” or “copy and paste” code, but is instead using context from a user’s workspace to synthesize and generate a suggestion.
Our experience shows that matching suggestions are most likely to occur in two situations: (i) when there is little or no context in the code editor for Copilot’s model to synthesize, or (ii) when a matching suggestion represents a common approach or method. If a code suggestion matches existing code, there is risk that using that suggestion could trigger claims of copyright infringement, which would depend on the amount and nature of code used, and the context of how the code is used. In many ways, this is the same risk that arises when using any code that a developer does not originate, such as copying code from an online source, or reusing code from a library. That is why responsible organizations and developers recommend that users employ code scanning policies to identify and evaluate potential matching code.
In Copilot, you can opt whether to allow Copilot to suggest code completions that match publicly available code on GitHub.com. For more information, see "Configuring GitHub Copilot settings on GitHub.com". If you have allowed suggestions that match public code, GitHub Copilot can provide you with details about the matching code when you accept such suggestions. Matching code does not necessarily mean copyright infringement, so it is ultimately up to the user to determine whether to use the suggestion, and what and who to attribute (along with other license compliance) in appropriate circumstances.
Does GitHub Copilot include a filtering mechanism to mitigate risk?
Yes, GitHub Copilot does include an optional code referencing filter to detect and suppress certain suggestions that match public code on GitHub.
GitHub has created a duplication detection filter to detect and suppress suggestions that contain code segments over a certain length that match public code on GitHub. This filter can be enabled by the administrator for your enterprise and it can apply for all organizations within your enterprise, or the administrator can defer control to individual organizations.
With the filter enabled, Copilot checks code suggestions for matches or near-matches against public code on GitHub of 65 lexemes or more (on average,150 characters). If there is a match, the suggestion will not be shown to the user.
In addition to off-topic, harmful, and offensive output filters, GitHub Copilot also scans the outputs for vulnerable code.
Does GitHub Copilot include features to make it easier for users to identify potentially relevant open source licenses for matching suggestions?
Yes, GitHub Copilot is previewing a code referencing feature as an additional tool to assist users to find and review potentially relevant open source licenses. Code referencing is currently available in Visual Studio Code. This feature searches across public GitHub repositories for code that matches a Copilot suggestion. If there’s a match, users will find its information displayed in the Copilot console log, including where the match occurred, any applicable licenses, and a deep link to learn more. The deep link will take users to a navigable page on GitHub.com to browse examples of the code match and their repository licenses, and see how many repositories—including ones without licenses—that code appears in, as well as links to those repositories. Copilot users can review this information to determine whether the applicable suggestions are suitable for use, and whether additional measures may be necessary to use them.
Who owns the suggestions provided by GitHub Copilot?
We don’t determine whether a suggestion is capable of being owned, but we are clear that GitHub does not claim ownership of a suggestion. Whether a suggestion generated by an AI model can be owned depends on many factors (e.g. the intellectual property law in the relevant country, the length of the suggestion, the extent that suggestion is considered ‘functional’ instead of expressive, etc).
If a suggestion is capable of being owned, our terms are clear: GitHub does not claim ownership.
GitHub does not claim ownership of any suggestion. In certain cases, it is possible for Copilot to produce similar suggestions to different users. For example, two unrelated users both starting new files to code the quicksort algorithm in Java will likely get the same suggestion. The possibility of providing similar suggestions to multiple users is a common part of generative AI systems.
Can GitHub Copilot introduce insecure code in its suggestions?
Public code may contain insecure coding patterns, bugs, or references to outdated APIs or idioms. When GitHub Copilot synthesizes code suggestions based on this data, it can also synthesize code that contains these undesirable patterns. Copilot has filters in place that either block or notify users of insecure code patterns that are detected in Copilot suggestions. These filters target the most common vulnerable coding patterns, including hardcoded credentials, SQL injections, and path injections. Additionally, in recent years we’ve provided tools such as GitHub Advanced Security, GitHub Actions, Dependabot, and CodeQL to open source projects to help improve code quality. Of course, you should always use GitHub Copilot together with good testing and code review practices and security tools, as well as your own judgment.
Is GitHub Copilot intended to fully automate code generation and replace developers?
No. Copilot is a tool intended to make developers more efficient. It’s not intended to replace developers, who should continue to apply the same sorts of safeguards and diligence they would apply with regard to any third-party code of unknown origin.
The product is called “Copilot” not “Autopilot” and it’s not intended to generate code without oversight. You should use exactly the same sorts of safeguards and diligence with Copilot’s suggestions as you would use with any third-party code.
Identifying best practices for use of third party code is beyond the scope of this section. That said, whatever practices your organization currently uses – rigorous functionality testing, code scanning, security testing, etc. – you should continue these policies with Copilot’s suggestions. Moreover, you should make sure your code editor or editor does not automatically compile or run generated code before you review it.
Can GitHub Copilot users simply use suggestions without concern?
Not necessarily. GitHub Copilot users should align their use of Copilot with their respective risk tolerances.
As noted above, GitHub Copilot is not intended to replace developers, or their individual skill and judgment, and is not intended to fully automate the process of code development. The same risks that apply to the use of any third-party code apply to the use of Copilot’s suggestions.
Depending on your particular use case, you should consider implementing the protections discussed above. It is your responsibility to assess what is appropriate for the situation and implement appropriate safeguards.
You’re entitled to IP indemnification from GitHub for the unmodified suggestions when Copilot’s filtering is enabled. If you do elect to enable this feature, the copyright responsibility is ours, not our customers. As part of our ongoing commitment to responsible AI, GitHub and Microsoft extends our IP indemnity and protection support to our customers who are empowering their teams with GitHub Copilot. See Microsoft's Copilot Copyright Commitment for more details.
Does GitHub Copilot support accessibility features?
We are conducting internal testing of GitHub Copilot’s ease of use by developers with disabilities and working to ensure that GitHub Copilot is accessible to all developers. Please feel free to share your feedback on GitHub Copilot accessibility in our feedback forum.
Does GitHub Copilot produce offensive outputs?
GitHub Copilot includes filters to block offensive language in the prompts and to avoid synthesizing suggestions in sensitive contexts. We continue to work on improving the filter system to more intelligently detect and remove offensive outputs. If you see offensive outputs, please report them directly to copilot-safety@github.com so that we can improve our safeguards. GitHub takes this challenge very seriously and we are committed to addressing it.
Will GitHub Copilot work as well using languages other than English?
Given public sources are predominantly in English, GitHub Copilot will likely work less well in scenarios where natural language prompts provided by the developer are not in English and/or are grammatically incorrect. Therefore, non-English speakers might experience a lower quality of service.
GeneralPlans & pricingPrivacyResponsible AI
General
What is GitHub Copilot?
GitHub Copilot transforms the developer experience. Backed by the leaders in AI, GitHub Copilot provides contextualized assistance throughout the software development lifecycle, from inline suggestions and chat assistance in the IDE to code explanations and answers to docs in GitHub and more. With GitHub Copilot elevating their workflow, developers can focus on: value, innovation, and happiness.
GitHub Copilot enables developers to focus more energy on problem solving and collaboration and spend less effort on the mundane and boilerplate. That’s why developers who use GitHub Copilot report up to 75% higher satisfaction with their jobs than those who don’t and are up to 55% more productive at writing code without sacrifice to quality, which all adds up to engaged developers shipping great software faster.
GitHub Copilot integrates with leading editors, including Visual Studio Code, Visual Studio, JetBrains IDEs, and Neovim, and, unlike other AI coding assistants, is natively built into GitHub. Growing to millions of individual users and tens of thousands of business customers, GitHub Copilot is the world’s most widely adopted AI developer tool and the competitive advantage developers ask for by name.
Who is eligible to access GitHub Copilot for free?
GitHub Copilot Free is a new free pricing tier with limited functionality for individual developers. Users assigned a Copilot Business or Copilot Enterprise seat are not eligible for access. Users with access to Copilot Pro through a paid subscription, trial, or through an existing verified OSS, student, faculty, or MVP account may elect to use Free instead.
What languages, IDEs, and platforms does GitHub Copilot support?
GitHub Copilot is trained on all languages that appear in public repositories. For each language, the quality of suggestions you receive may depend on the volume and diversity of training data for that language. For example, JavaScript is well-represented in public repositories and is one of GitHub Copilot’s best supported languages. Languages with less representation in public repositories may produce fewer or less robust suggestions.
GitHub Copilot is available as an extension in Visual Studio Code, Visual Studio, Vim, Neovim, the JetBrains suite of IDEs, and Azure Data Studio. Although inline suggestion functionality is available across all these extensions, chat functionality is currently available only in Visual Studio Code, JetBrains, and Visual Studio. GitHub Copilot is also supported in terminals through GitHub CLI and as a chat integration in Windows Terminal Canary. With the GitHub Copilot Enterprise plan, GitHub Copilot is natively integrated into GitHub.com. All plans are supported in GitHub Copilot in GitHub Mobile. GitHub Mobile for Copilot Pro and Copilot Business have access to Bing and public repository code search. Copilot Enterprise in GitHub Mobile gives you additional access to your organization's knowledge.
Does GitHub Copilot “copy/paste”?
No, GitHub Copilot generates suggestions using probabilistic determination.
When thinking about intellectual property and open source issues, it is critical to understand how GitHub Copilot really works. The AI models that create GitHub Copilot’s suggestions may be trained on public code, but do not contain any code. When they generate a suggestion, they are not “copying and pasting” from any codebase.
To generate a code suggestion, the GitHub Copilot extension begins by examining the code in your editor—focusing on the lines just before and after your cursor, but also information including other files open in your editor and the URLs of repositories or file paths to identify relevant context. That information is sent to GitHub Copilot’s model, to make a probabilistic determination of what is likely to come next and generate suggestions.
To generate a suggestion for chat in the code editor, the GitHub Copilot extension creates a contextual prompt by combining your prompt with additional context including the code file open in your active document, your code selection, and general workspace information, such as frameworks, languages, and dependencies. That information is sent to GitHub Copilot’s model, to make a probabilistic determination of what is likely to come next and generate suggestions.
To generate a suggestion for chat on GitHub.com, such as providing an answer to a question from your chat prompt, GitHub Copilot creates a contextual prompt by combining your prompt with additional context including previous prompts, the open pages on GitHub.com as well as retrieved context from your codebase or Bing search. That information is sent to GitHub Copilot’s model, to make a probabilistic determination of what is likely to come next and generate suggestions.
What are the differences between the GitHub Copilot Business, GitHub Copilot Enterprise, and GitHub Copilot Individual plans?
GitHub Copilot has multiple offerings for organizations and an offering for individual developers. All the offerings include both inline suggestion and chat assistance. The primary differences between the organization offerings and the individual offering are license management, policy management, and IP indemnity.
Organizations can choose between GitHub Copilot Business and GitHub Copilot Enterprise. GitHub Copilot Business primarily features GitHub Copilot in the coding environment - that is the IDE, CLI and GitHub Mobile. GitHub Copilot Enterprise includes everything in GitHub Copilot Business. It also  adds an additional layer of customization for organizations and integrates into GitHub.com as a chat interface to allow developers to converse with GitHub Copilot throughout the platform. GitHub Copilot Enterprise can index an organization’s codebase for a deeper understanding of the customer’s knowledge for more tailored suggestions and will offer customers access to fine-tuned custom, private models for inline suggestions.
GitHub Copilot Individual is designed for individual developers, freelancers, students, educators, and open source maintainers. The plan includes all the features of GitHub Copilot Business except organizational license management, policy management, and IP indemnity.
What data has GitHub Copilot been trained on?
GitHub Copilot is powered by generative AI models developed by GitHub, OpenAI, and Microsoft. It has been trained on natural language text and source code from publicly available sources, including code in public repositories on GitHub. Starting on April 24, GitHub may also use interactions from users with a Copilot Free, Copilot Pro, and Copilot Pro+ subscription - including inputs, outputs, code snippets, and associated context - to train and improve our AI models unless they have opted out. This allows us to build more intelligent, context-aware coding assistance for a more diverse set of coding tasks based on real-world development patterns. Users were notified 30 days before the change went into effect and can opt out from allowing their data to be used for training in their GitHub account settings at any time.
Which plan includes GitHub Copilot Autofix?
GitHub Copilot Autofix provides contextual explanations and code suggestions to help developers fix vulnerabilities in code, and is included in GitHub Advanced Security.
What if I do not want GitHub Copilot?
GitHub Copilot is entirely optional and requires you to opt in before gaining access. You can easily configure its usage directly in the editor, enabling or disabling it at any time. Additionally, you have control over which file types GitHub Copilot is active for.
How do I control access to GitHub Copilot in my company?
Access to Copilot Business and Enterprise is managed by your GitHub Administrator. They can control access to preview features, models, and set GitHub Copilot policies for your organization. Additionally, you can use your network firewall to explicitly allow access to Copilot Business and/or block access to Copilot Pro or Free. For more details, refer to the documentation.
Plans & pricing
What are the differences between the Free, Pro, Pro+, Max, Business, and Enterprise plans?
GitHub Copilot has multiple offerings for organizations and an offering for individual developers. All the offerings include both code completion and chat assistance. The primary differences between the organization offerings and the individual offering are license management, policy management, and IP indemnity.
Organizations can choose between GitHub Copilot Business and GitHub Copilot Enterprise. GitHub Copilot Business primarily features GitHub Copilot in the coding environment - that is the IDE, CLI and GitHub Mobile. GitHub Copilot Enterprise includes everything in GitHub Copilot Business. It also  adds an additional layer of customization for organizations and integrates into GitHub.com as a chat interface to allow developers to converse with Copilot  throughout the platform. GitHub Copilot Enterprise can index an organization’s codebase for a deeper understanding of the customer’s knowledge for more tailored suggestions and will offer customers access to fine-tuned custom, private models for code completion.
GitHub Copilot Pro is designed for individual developers, freelancers, students, educators, and open source maintainers. The plan includes all the features of GitHub Copilot Business except organizational license management, policy management, and IP indemnity.
GitHub Copilot Max is built for heavy Copilot usage, including sustained agent-driven workflows, and includes $100/month in GitHub AI Credits.
How can I upgrade my GitHub Copilot Free license to Copilot Pro?
If you're on the Free plan, you can upgrade to Pro through your Copilot settings page or directly on the Copilot marketing page.
What is included in GitHub Copilot Free?
GitHub Copilot Free users are limited to 2000 completions and 50 chat requests (including Copilot Edits).
Which plan includes GitHub Copilot Autofix?
GitHub Copilot Autofix provides contextual explanations and code suggestions to help developers fix vulnerabilities in code, and is included in GitHub Advanced Security and available to all public repositories.
Can users in my organization use Copilot code reviews for their pull requests if they don’t have a Copilot license?
Organizations can now enable Copilot code review on all pull requests on github.com—including pull requests from users who are not assigned a Copilot license.
This allows you to extend the quality and rich analysis of Copilot code review to all pull requests, regardless of its author, giving you complete coverage and confidence that pull requests have been reviewed.
To enable this functionality, an enterprise/org admin must first have Copilot enabled and then enabled two policies.
Note: This capability is not supported for Copilot code reviews in VS Code or other IDEs.
How does billing work for Copilot code review usage generated by users without a Copilot license?
Usage from non-licensed users is billed directly to your organization as GitHub AI Credits. This flexible model allows you to get full review coverage on every PR without purchasing a full Copilot seat for non-development contributors who may not need Copilot.
Usage from your existing licensed users continues to draw from their included monthly allowance as it does today. Beginning June 1, 2026, code review workflows also consume GitHub Actions minutes.
Is Copilot code review usage from users without a Copilot license enabled by default? How do I control the cost?
No. This capability is off by default and gives the enterprise admin control to enable or disable. An admin must explicitly enable two separate policies to activate:
‘GitHub AI Credits paid usage’ must be enabled to allow enterprises to be charged for GitHub AI Credits exceeding their included usage.
A new Copilot code review policy (‘Allow members without a Copilot license to use Copilot code review in github.com’) must also be enabled.
We encourage admins to set up budgets to control spending on our metered products, especially customers who have not enabled the ‘Premium request paid usage’ policy in the past. You can track all premium request usage in your billing dashboard to monitor and control spending.
What are GitHub AI Credits?
GitHub AI Credits are how you pay for AI usage in GitHub Copilot. Every plan includes a monthly allowance: 1 AI credit = $0.01 USD.
You use credits when you chat with Copilot, work with agents, or use Copilot CLI, Spaces, and Spark. Code completions and next edit suggestions don't use credits. They remain unlimited with every paid plan.
How many credits an interaction uses depends on the model you choose and the complexity of the task. A quick question to a lightweight model costs a fraction of a credit. A longer agent session on a frontier model across many files costs more.
What happens when I hit my usage limit?
When you've used your monthly allowance, you have a few options:
Wait for your next cycle. Your included allowance resets every month.
Keep working with paid usage. Set a dollar budget for additional usage and Copilot continues without interruption. Credits draw down at $0.01 each, so a $10 budget covers 1,000 credits.
Switch to a less expensive model. Lightweight models use fewer credits per interaction and stretch your remaining allowance further.
On GitHub Copilot Business and GitHub Copilot Enterprise, admins set usage limits and decide whether additional paid usage is allowed. If it isn't, Copilot pauses until the next cycle.
You can track your usage and reset date in your Copilot settings, with alerts at 75%, 90%, and 100% of any configured budget.
Privacy
What personal data does GitHub Copilot process?
GitHub Copilot processes personal data based on how Copilot is accessed and used: whether via GitHub.com, mobile app, extensions, or one of various IDE extensions, or through features like suggestions for the command line interface (CLI), IDE code completions, or personalized chat on GitHub.com. The types of personal data processed may include:
User Engagement Data: This includes pseudonymous identifiers captured on user interactions with Copilot, such as accepted or dismissed completions, error messages, system logs, and product usage metrics.
Prompts: These are inputs for chat or code, along with context, sent to Copilot's AI to generate suggestions.
Suggestions: These are the AI-generated code lines or chat responses provided to users based on their prompts.
Feedback Data: This comprises real-time user feedback, including reactions (e.g., thumbs up/down) and optional comments, along with feedback from support tickets.
Does GitHub use Copilot Business or Enterprise data to train GitHub’s model?
No. GitHub does not use either Copilot Business or Enterprise data to train its models.
How does GitHub use the Copilot data from Business and Enterprise Subscribers?
How GitHub uses Copilot data depends on how the user accesses Copilot and for what purpose. Users can access GitHub Copilot through the web, extensions, mobile apps, computer terminal, and various IDEs (Integrated Development Environments). GitHub generally uses personal data to:
Deliver, maintain, and update the services as per the customer's configuration and usage, to ensure personalized experiences and recommendations
Troubleshoot, which involves preventing, detecting, resolving, and mitigating issues, including security incidents and product-related problems, by fixing software bugs and maintaining the online services' functionality and up-to-dateness
Enhance user productivity, reliability, effectiveness, quality, privacy, accessibility, and security by keeping the service current and operational
These practices are outlined in GitHub’s Data Protection Agreement (DPA), which details our data handling commitments to our data controller customers. GitHub also uses certain personal data with customer authorization under the DPA, for the following purposes:
Billing and account management
To comply with and resolve legal obligations
For abuse detection, prevention, and protection, virus scanning, and scanning to detect violations of terms of service
To generate summary reports for calculating employee commissions and partner incentives
To produce aggregated reports for internal use and strategic planning, covering areas like forecasting, revenue analysis, capacity planning, and product strategy.
How does GitHub use the Copilot data from Individual (Free/Pro/Pro+) Subscribers?
GitHub uses the Copilot data from Individual subscribers for all the operational purposes described above for Business/Enterprise subscribers.
In addition, for Individual subscribers only: GitHub may use Copilot interaction data — including prompts (inputs), suggestions (outputs), and code snippets generated during Copilot sessions — to train and improve AI models. This training helps improve code suggestions for all Copilot users.
Individual subscribers can opt out of having their data used for AI model training at any time through https://github.com/settings/copilot/features. Opting out does not affect your access to Copilot features.
For details on GitHub's data processing activities as a controller, particularly for Copilot Free, Copilot Pro, and Copilot Pro customers, refer to the GitHub Terms of Service and the GitHub Privacy Statement.
How long does GitHub retain Copilot data for Business and Enterprise customers?
If and for how long GitHub’s retains Copilot data depends on how a Copilot user accesses Copilot and for what purpose. The default settings for Copilot Business and Enterprise Customers are as follows:
Access through IDE for Chat and Code Completions:
Prompts and Suggestions: Not retained
User Engagement Data: Kept for two years.
Feedback Data: Stored for as long as needed for its intended purpose.
All other GitHub Copilot access and use:
Prompts and Suggestions: Retained for 28 days.
User Engagement Data: Kept for two years.
Feedback Data: Stored for as long as needed for its intended purpose.
Why do some Copilot features retain prompts and suggestions?
Retaining prompts and suggestions is necessary for chat on github.com, mobile, and CLI Copilot because those features’ effectiveness depends on using thread history to improve responses. The Copilot model requires access to previous interactions to deliver accurate and relevant suggestions.
Does GitHub Copilot support compliance with the GDPR and other data protection laws?
Yes. GitHub and customers can enter a Data Protection Agreement that supports compliance with the GDPR and similar legislation.
Does GitHub Copilot ever output personal data?
While we've designed GitHub Copilot with privacy in mind, the expansive definition of personal data under legislation like the EU’s General Data Protection Regulation (GDPR) means we can't guarantee it will never output such data. The Large Language Model (LLM) powering GitHub Copilot was trained on public code and there were instances in our tests where the tool made suggestions resembling personal data. These suggestions were typically synthesized and not tied to real individuals.
How does Copilot allow users to access, alter or delete personal data?
These actions are available to Copilot users as described in the GitHub Privacy Statement.
Responsible AI
What are the intellectual property considerations when using GitHub Copilot?
The primary IP considerations for GitHub Copilot relate to copyright. The model that powers Copilot is trained on a broad collection of publicly accessible code, which may include copyrighted code, and Copilot’s suggestions (in rare instances) may resemble the code its model was trained on. Here’s some basic information you should know about these considerations:
Copyright law permits the use of copyrighted works to train AI models:  Countries around the world have provisions in their copyright laws that enable machines to learn, understand, extract patterns, and facts from copyrighted materials, including software code. For example, the European Union, Japan, and Singapore, have express provisions permitting machine learning to develop AI models. Other countries including Canada, India, and the United States also permit such training under their fair use/fair dealing provisions. GitHub Copilot’s AI model was trained with the use of code from GitHub’s public repositories—which are publicly accessible and within the scope of permissible copyright use.
What about copyright risk in suggestions? In rare instances (less than 1% based on GitHub’s research), suggestions from GitHub may match examples of code used to train GitHub’s AI model. Again, Copilot does not “look up” or “copy and paste” code, but is instead using context from a user’s workspace to synthesize and generate a suggestion.
Our experience shows that matching suggestions are most likely to occur in two situations: (i) when there is little or no context in the code editor for Copilot’s model to synthesize, or (ii) when a matching suggestion represents a common approach or method. If a code suggestion matches existing code, there is risk that using that suggestion could trigger claims of copyright infringement, which would depend on the amount and nature of code used, and the context of how the code is used. In many ways, this is the same risk that arises when using any code that a developer does not originate, such as copying code from an online source, or reusing code from a library. That is why responsible organizations and developers recommend that users employ code scanning policies to identify and evaluate potential matching code.
In Copilot, you can opt whether to allow Copilot to suggest code completions that match publicly available code on GitHub.com. For more information, see "Configuring GitHub Copilot settings on GitHub.com". If you have allowed suggestions that match public code, GitHub Copilot can provide you with details about the matching code when you accept such suggestions. Matching code does not necessarily mean copyright infringement, so it is ultimately up to the user to determine whether to use the suggestion, and what and who to attribute (along with other license compliance) in appropriate circumstances.
Does GitHub Copilot include a filtering mechanism to mitigate risk?
Yes, GitHub Copilot does include an optional code referencing filter to detect and suppress certain suggestions that match public code on GitHub.
GitHub has created a duplication detection filter to detect and suppress suggestions that contain code segments over a certain length that match public code on GitHub. This filter can be enabled by the administrator for your enterprise and it can apply for all organizations within your enterprise, or the administrator can defer control to individual organizations.
With the filter enabled, Copilot checks code suggestions for matches or near-matches against public code on GitHub of 65 lexemes or more (on average,150 characters). If there is a match, the suggestion will not be shown to the user.
In addition to off-topic, harmful, and offensive output filters, GitHub Copilot also scans the outputs for vulnerable code.
Does GitHub Copilot include features to make it easier for users to identify potentially relevant open source licenses for matching suggestions?
Yes, GitHub Copilot is previewing a code referencing feature as an additional tool to assist users to find and review potentially relevant open source licenses. Code referencing is currently available in Visual Studio Code. This feature searches across public GitHub repositories for code that matches a Copilot suggestion. If there’s a match, users will find its information displayed in the Copilot console log, including where the match occurred, any applicable licenses, and a deep link to learn more. The deep link will take users to a navigable page on GitHub.com to browse examples of the code match and their repository licenses, and see how many repositories—including ones without licenses—that code appears in, as well as links to those repositories. Copilot users can review this information to determine whether the applicable suggestions are suitable for use, and whether additional measures may be necessary to use them.
Who owns the suggestions provided by GitHub Copilot?
We don’t determine whether a suggestion is capable of being owned, but we are clear that GitHub does not claim ownership of a suggestion. Whether a suggestion generated by an AI model can be owned depends on many factors (e.g. the intellectual property law in the relevant country, the length of the suggestion, the extent that suggestion is considered ‘functional’ instead of expressive, etc).
If a suggestion is capable of being owned, our terms are clear: GitHub does not claim ownership.
GitHub does not claim ownership of any suggestion. In certain cases, it is possible for Copilot to produce similar suggestions to different users. For example, two unrelated users both starting new files to code the quicksort algorithm in Java will likely get the same suggestion. The possibility of providing similar suggestions to multiple users is a common part of generative AI systems.
Can GitHub Copilot introduce insecure code in its suggestions?
Public code may contain insecure coding patterns, bugs, or references to outdated APIs or idioms. When GitHub Copilot synthesizes code suggestions based on this data, it can also synthesize code that contains these undesirable patterns. Copilot has filters in place that either block or notify users of insecure code patterns that are detected in Copilot suggestions. These filters target the most common vulnerable coding patterns, including hardcoded credentials, SQL injections, and path injections. Additionally, in recent years we’ve provided tools such as GitHub Advanced Security, GitHub Actions, Dependabot, and CodeQL to open source projects to help improve code quality. Of course, you should always use GitHub Copilot together with good testing and code review practices and security tools, as well as your own judgment.
Is GitHub Copilot intended to fully automate code generation and replace developers?
No. Copilot is a tool intended to make developers more efficient. It’s not intended to replace developers, who should continue to apply the same sorts of safeguards and diligence they would apply with regard to any third-party code of unknown origin.
The product is called “Copilot” not “Autopilot” and it’s not intended to generate code without oversight. You should use exactly the same sorts of safeguards and diligence with Copilot’s suggestions as you would use with any third-party code.
Identifying best practices for use of third party code is beyond the scope of this section. That said, whatever practices your organization currently uses – rigorous functionality testing, code scanning, security testing, etc. – you should continue these policies with Copilot’s suggestions. Moreover, you should make sure your code editor or editor does not automatically compile or run generated code before you review it.
Can GitHub Copilot users simply use suggestions without concern?
Not necessarily. GitHub Copilot users should align their use of Copilot with their respective risk tolerances.
As noted above, GitHub Copilot is not intended to replace developers, or their individual skill and judgment, and is not intended to fully automate the process of code development. The same risks that apply to the use of any third-party code apply to the use of Copilot’s suggestions.
Depending on your particular use case, you should consider implementing the protections discussed above. It is your responsibility to assess what is appropriate for the situation and implement appropriate safeguards.
You’re entitled to IP indemnification from GitHub for the unmodified suggestions when Copilot’s filtering is enabled. If you do elect to enable this feature, the copyright responsibility is ours, not our customers. As part of our ongoing commitment to responsible AI, GitHub and Microsoft extends our IP indemnity and protection support to our customers who are empowering their teams with GitHub Copilot. See Microsoft's Copilot Copyright Commitment for more details.
Does GitHub Copilot support accessibility features?
We are conducting internal testing of GitHub Copilot’s ease of use by developers with disabilities and working to ensure that GitHub Copilot is accessible to all developers. Please feel free to share your feedback on GitHub Copilot accessibility in our feedback forum.
Does GitHub Copilot produce offensive outputs?
GitHub Copilot includes filters to block offensive language in the prompts and to avoid synthesizing suggestions in sensitive contexts. We continue to work on improving the filter system to more intelligently detect and remove offensive outputs. If you see offensive outputs, please report them directly to copilot-safety@github.com so that we can improve our safeguards. GitHub takes this challenge very seriously and we are committed to addressing it.
Will GitHub Copilot work as well using languages other than English?
Given public sources are predominantly in English, GitHub Copilot will likely work less well in scenarios where natural language prompts provided by the developer are not in English and/or are grammatically incorrect. Therefore, non-English speakers might experience a lower quality of service.
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/features/copilot
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Ffeatures%2Fcopilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## GitHub Copilot app · GitHub

- Source URL: https://github.com/features/ai/github-app
- Crawl depth: 1

GitHub Copilot app · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
AI
GitHub Copilot
Desktop App
GitHub Spark
GitHub Models
GitHub Copilot app
From issue to merge, in one app
The GitHub Copilot app is the only desktop experience for agent-driven development built natively on GitHub. Available for customers on paid GitHub Copilot plans for macOS, Windows, and Linux.
Download for Windows (x64)
Read the docs
Delegate to agentsCentralized inboxShape canvasesReview and merge
Start a session from an issue, a prompt, or a PR already in flight.
Run multiple sessions across every area of work
Open a session from real work across your issues, pull requests, or prompts.
Parallel workflows, fully in view
Take control of your workflow. Every session comes with a workspace for your branches, files, and conversations.
Learn more
Isolated spaces for every session
Work stays separated, even when you have more than one task in motion.
Learn more
Built-in validation loop
Inspect diffs, preview via in-app browser, run terminal checks, and merge PRs directly inside your session.
Learn more
Automated workflows
Turn skills and prompts into repeatable work that can be run on a regular basis.
Learn more
Extend agents with your own tools
Your MCP servers, plugins, and skills all come together so you spend less time configuring and more time shipping.
Native GitHub context
Each session natively connects to your code, PRs, issues and search. Deep context without the manual config.
Learn more
Deploy custom skills
Custom repo and Copilot skills sync automatically across your sessions. Turn any skill into a workflow with one-click.
Learn more
Connect external data via MCP’s
Your repo's MCPs sync automatically. Connect additional custom MCP servers via local or HTTP config.
Learn more
Plans
Pricing
The GitHub Copilot app requires an active paid GitHub Copilot subscription.
For individualsFor businesses
Free
For getting started with GitHub Copilot.
$0USD
Get startedOpen in VS Code
What's included:
2,000 completions per month
Access to Haiku 4.5, GPT-5 mini, and more
Copilot CLI
No credit card required. Verified students have access to the GitHub Copilot Student plan. Learn more
Pro
For everyday coding with agents in GitHub Copilot.
$10USDper user / month
New plan sign-ups are temporarily paused as we ensure a high-quality experience. Existing Student, Pro, and Pro+ customers can upgrade to Max. We appreciate your patience. Learn more
Everything from Free and:
Access to Cloud agent and code review
Code review will incur Actions usage.
Unlimited code completion and next edit suggestions
Response times may vary during periods of high usage. Requests may be subject to rate limiting.
Access to 3rd party agents (Claude Code and Codex)
Model selection
GitHub Copilot app
$15 monthly total credits for Pro
Flex allotments will vary over time.
Pro+
For more complex development with premium models.
$39USDper user / month
New plan sign-ups are temporarily paused as we ensure a high-quality experience. Existing Student, Pro, and Pro+ customers can upgrade to Max. We appreciate your patience. Learn more
Everything from Pro and:
Access to premium models, including Opus
Audit logs
4x+ included usage than Pro
$70 monthly total credits for Pro+
Flex allotments will vary over time.
Max
For sustained, high-volume agent workflows with GitHub Copilot.
$100USDper user / month
New plan sign-ups are temporarily paused as we ensure a high-quality experience. Existing Student, Pro, and Pro+ customers can upgrade to Max. We appreciate your patience. Learn more
Everything in Pro+ and:
Priority access to new models and features
2.9x+ included usage than Pro+
$200 monthly total credits for Pro+
Flex allotments will vary over time.
Best value
Share your feedback
Help us build
Whether you find a bug or have an idea for a feature, we want to hear from you. Let us know and we'll take your ideas into account.
Download for Windows (x64)
Share feedback
Related resources
Explore documentation
Guides, quick starts, and reference for everything in the app.
Read the docs
Check out the repo
Explore the README, file an issue, join in the discussion.
Explore the repo
Keep up-to-date on the latest
Get the latest on new features and fixes as we ship it.
Read the changelog
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/features/ai/github-app
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Ffeatures%2Fai%2Fgithub-app
- https://github.com/features/copilot
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## MCP Registry · GitHub

- Source URL: https://github.com/mcp
- Crawl depth: 1

MCP Registry · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Appearance settings
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Appearance settings
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Connect models to the real world
Servers and tools from the community that connect models to files, APIs, databases, and more.
Search MCP Registry
Search
All MCP servers
100
Markitdown
Install
Convert various file formats (PDF, Word, Excel, images, audio) to Markdown.
By microsoft
149,388
Netdata
Install
Real-time infrastructure monitoring with metrics, logs, alerts, and ML-based anomaly detection.
By netdata
79,097
Context7
Install
Up-to-date code docs for any prompt
By upstash
57,077
Chrome DevTools MCP
Install
MCP server for Chrome DevTools
By ChromeDevTools
43,206
Playwright
Install
Automate web browsers using accessibility trees for testing and data extraction.
By microsoft
33,699
GitHub
Install
Connect AI assistants to GitHub - manage repos, issues, PRs, and workflows through natural language.
By github
30,543
Serena
Install
Semantic code retrieval & editing tools for coding agents.
By oraios
25,167
Unity
Install
Control the Unity Editor from MCP clients via a Unity bridge + local Python server.
By CoplayDev
10,499
Firecrawl
Install
Extract web data with Firecrawl
By firecrawl
6,534
Desktop Commander
Install
MCP server for terminal commands, file operations, and process management
By wonderwhy-er
6,137
Notion
Install
Official MCP server for Notion API
By makenotion
4,404
Azure MCP Server
Install
All Azure MCP tools to create a seamless connection between AI agents and Azure services.
By microsoft
3,289
Microsoft Fabric MCP Server
Install
MCP tools for interacting with Microsoft Fabric
By microsoft
3,289
DBHub
Install
Minimal, token-efficient Database MCP Server for PostgreSQL, MySQL, SQL Server, SQLite, MariaDB
By bytebase
2,933
Supabase
Install
MCP server for interacting with the Supabase platform
By supabase
2,728
Brightdata
Install
Bright Data's Web MCP server enabling AI agents to search, extract & navigate the web
By brightdata
2,442
Tavily
Install
MCP server for advanced web search using Tavily
By tavily-ai
2,081
Azure DevOps
Install
Interact with Azure DevOps services like repositories, work items, builds, releases, test plans, and code search.
By microsoft
1,791
Microsoft Learn
Install
Enables clients like GitHub Copilot and other AI agents to bring trusted and up-to-date information directly from Microsoft's official documentation.
By MicrosoftDocs
1,696
Stripe
Install
MCP server integrating with Stripe - tools for customers, products, payments, and more.
By stripe
1,600
Figma MCP Server
Install
The Figma MCP server brings Figma design context directly into your AI workflow.
By figma
1,574
Microsoft Nuget
Install
A Model Context Protocol (MCP) server for NuGet.
By NuGet
1,548
Terraform
Install
Generate more accurate Terraform and automate workflows for HCP Terraform and Terraform Enterprise
By hashicorp
1,397
Apify
Install
Extract data from any website with thousands of scrapers, crawlers, and automations on Apify Store ⚡
By apify
1,320
Mongodb
Install
MongoDB Model Context Protocol Server
By mongodb-js
1,045
Nuxt
Install
MCP server helping models understand your Vite/Nuxt app.
By antfu
909
Atlassian
Install
Atlassian Rovo MCP Server
By atlassian
768
Vercel Next Dev Tools
Install
Next.js development tools MCP server with stdio transport
By vercel
767
Getsentry Sentry
Install
MCP server for Sentry - error monitoring, issue tracking, and debugging for AI assistants
By getsentry
722
Elasticsearch
Install
MCP server for connecting to Elasticsearch data and indices. Supports search queries, mappings, ES|QL, and shard information through natural language interactions.
By elastic
670
Previous1234Next
Footer
© 2026 GitHub, Inc.
Footer navigation
Terms
Privacy
Security
Status
Community
Docs
Contact
Manage cookies
Do not share my personal information
You can’t perform that action at this time.

### Links
- https://github.com/mcp
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fmcp
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## GitHub Actions · GitHub

- Source URL: https://github.com/features/actions
- Crawl depth: 1

GitHub Actions · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Features
GitHub Copilot
Security
Actions
Codespaces
Issues
Code review
Discussions
Code search
GitHub Actions
Automate your workflow from idea to production
GitHub Actions makes it easy to automate all your software workflows, now with world-class CI/CD. Build, test, and deploy your code right from GitHub. Make code reviews, branch management, and issue triaging work the way you want.
Get started with actionsContact sales
Kick off workflows on any GitHub event to automate tasks
Hosted runners
Linux, macOS, Windows, ARM, GPU, and containers make it easy to build and test all your projects. Run directly on a VM or inside a container. Use your own VMs, in the cloud or on-prem, with self-hosted runners.
Matrix builds
Save time with matrix workflows that simultaneously test across multiple operating systems and versions of your runtime.
Any language
GitHub Actions supports Node.js, Python, Java, Ruby, PHP, Go, Rust, .NET, and more. Build, test, and deploy applications in your language of choice.
Live logs
See your workflow run in realtime with color and emoji. It’s one click to copy a link that highlights a specific line number to share a CI/CD failure.
Built in secret store
Automate your software development practices with workflow files embracing the Git flow by codifying it in your repository.
Multi-container testing
Test your web service and its DB in your workflow by simply adding some docker-compose to your workflow file.
Run a workflow
on any event
Whether you want to build a container, deploy a web service, or automate welcoming new users to your open source projects—there's an action for that. Pair GitHub Packages with Actions to simplify package management, including version updates, fast distribution with our global CDN, and dependency resolution, using your existing GITHUB_TOKEN.
Actions marketplace
GitHub Actions connects all of your tools to automate every step of your development workflow.
Explore the actions marketplace
Easily deploy to any cloud, create tickets in Jira, or publish a package to npm.
Want to venture off the beaten path? Use the millions of open source libraries available on GitHub to create your own actions. Write them in JavaScript or create a container action—both can interact with the full GitHub API and any other public API.
Secure package registry for code and workflows
Securely store and manage your code and packages with GitHub credentials, integrated into your workflows via APIs and webhooks. Enjoy fast, reliable downloads through a global CDN for optimized performance.
Read the GitHub Packages docs
“
Actions is an exciting development and unlocks so much potential beyond CI/CD. It promises to streamline our workflows for a variety of tasks, from deploying our websites to querying the GitHub API for custom status reports to standard CI builds.
Ralf GommersSciPy maintainer
GitHub Actions is free for public repositories
We take pride in our Open Source legacy, and are happy to provide free CI/CD for public repositories. Check out the doc to see which runners are included.
View docs
Host your own runners or use GitHub-hosted runners
Check out plan details to see how many minutes are included and the pricing table below to see which runners you can use your free minutes on.
View pricing
The future of workflow automation is now
Get started with actions
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/features/actions
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Ffeatures%2Factions
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## GitHub Codespaces · GitHub

- Source URL: https://github.com/features/codespaces
- Crawl depth: 1

GitHub Codespaces · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Features
GitHub Copilot
Security
Actions
Codespaces
Issues
Code review
Discussions
Code search
GitHub Codespaces
Secure development
made simple
GitHub Codespaces gets you up and coding faster with fully configured, secure cloud development environments native to GitHub.
Get started for freeContact Sales
Secure by design
Created with security in mind, Codespaces provides a secure development environment through its built-in capabilities and native integration with GitHub.
Collaborate
where you code
Codespaces provides a shared development environment and removes the need for complex, time consuming setups.
Your space, your way. Codespaces is a home away from home for your code that feels just like your usual machine.
Your space, your way. Codespaces is a home away from home for your code that feels just like your usual machine.
Start coding instantly from anywhere in the world. Switching projects? Grab a new machine from the cloud that’s preconfigured for that project. Your settings travel with you.
Tabs or spaces? Monokai or Solarized? Prettier or Beautify? It’s up to you. Control every nerdy detail only you care about with your own dotfiles repository.
Browser preview and port forwarding
Preview your changes and get feedback from teammates by sharing ports within the scope allowed by policy.
Onboard faster
Quickly spin up a codespace with only an IDE or browser and a GitHub account. With a few configuration files, you can give your developers an instant, fully configured, and secure development environment so they can start coding immediately.
What you can do with Codespaces
Code from any device. Want to code on an iPad? Go for it. Spin up Codespaces from any device with internet access. Don’t worry if your device is powerful enough—Codespaces lives in the cloud.
Onboard at the speed of thought. No more building your dev environment while you onboard. Codespaces launches instantly from any repository on GitHub with pre-configured, secure environments.
Fix bugs right from a pull request. Got a pull request detailing a bug or security issue? Open Codespaces right from the pull request without waiting for your dev environment to load.
Learn how GitHub’s Engineering Team builds with Codespaces
Read more
“
What used to be a 15-step process is just one step: open Codespaces and you’re off and running.
Clint ChesterDeveloper Lead, Synergy
“
Codespaces lets developers skip the tedious, error-prone stuff that normally stands between them and getting started on real work.
Keith AnnetteCloud Capability Lead, KPMG, UK
Start coding in seconds with Codespaces
Get started for free
Frequently asked questions
How does Codespaces work?
A codespace is a development environment that's hosted in the cloud. Customize your project for GitHub Codespaces by configuring dev container files to your repository (often known as configuration-as-code), which creates a repeatable codespace configuration for all users of your project.
GitHub Codespaces run on a various VM-based compute options hosted by GitHub.com, which you can configure from 2 core machines up to 32 core machines. Connect to your codespaces from the browser or locally using an IDE like Visual Studio Code or IntelliJ.
How do I use Codespaces?
There are a number of entry points to spin up a Codespaces environment, including:
A template.
Your repository for new feature work
An open pull request to explore work-in-progress
A commit in the repository's history to investigate a bug at a specific point in time
Visual Studio Code
In beta, can you also use your JetBrains IDE or JupyterLab
Learn more about how to use Codespaces in our documentation.
Is Codespaces available for individual developers?
Codespaces is available for developers in every organization, and under the control of the organization who pays for the user's codespace. All personal (individual) GitHub.com accounts include a quota of free usage each month, which organizations can enable (see the next question) for their private and internal repositories. GitHub will provide users in the free plan 120 core hours or 60 hours of run time on a 2 core codespace, plus 15 GB of storage each month. See how it's balanced on the billing page.
Is Codespaces available for teams and companies?
Codespaces is available for teams and companies, but needs to be enabled first in an organization’s settings. Teams and companies can select which repositories and users have access to Codespaces for added security and permissioning control. Learn how to enable Codespaces in an organization in our docs.
How much does Codespaces cost?
Codespaces is free for individual use up to 60 hours a month and comes with simple, pay-as-you-go pricing after that. It’s also available for organizations with pay-as-you-go pricing and has pricing controls so any company or team can determine how much they want to spend a month. Learn more about Codespaces pricing for organizations here.
Can I self-host Codespaces?
Codespaces cannot be self-hosted.
How do I access Codespaces with LinkedIn Learning?
You can use Codespaces directly through LinkedIn Learning. LinkedIn Learning offers 50+ courses across six of the most popular coding languages, as well as data science and machine learning. These courses are integrated with Codespaces, so you can get hands-on practice anytime, from any machine via LinkedIn. These courses will be unlocked on LinkedIn Learning for free through Feb. 2023. Learn more about LinkedIn Learning and GitHub Codespaces here.
How do I enable Codespaces on GitHub?
Codespaces is on by default for developers with a GitHub free account. If you belong to an organization, there may be a policy that prevents cloning—but if you can clone a repository, you will be able to start using Codespaces. Organizations will also need to pay for, enable, and manage their Codespaces instances.
Is Codespaces available for students?
Codespaces is available for free to students as part of the GitHub Student Developer Pack. Learn more about how to sign up and start using Codespaces and other GitHub products here.
Is Codespaces available for open source maintainers?
Codespaces provides both maintainers and contributors with generous free monthly usage.
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/features/codespaces
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Ffeatures%2Fcodespaces
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## GitHub Issues · Project planning for developers · GitHub

- Source URL: https://github.com/features/issues
- Crawl depth: 1

GitHub Issues · Project planning for developers · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Features
GitHub Copilot
Security
Actions
Codespaces
Issues
Code review
Discussions
Code search
GitHub Issues
Project planning for developers
Create issues, break them into sub-issues, track progress, add custom fields, and have conversations. Visualize large projects as tables, boards, or roadmaps, and automate everything with code.
Start using projectsContact sales
Logos for Shopify, Vercel, Stripe, Ford, and NASA
Break issues into sub-issues
Tackle complex issues with sub-issues and track their status with progress indicators. Navigate the full scope of work all in one view.
Streamline conversations
Express ideas with GitHub Flavored Markdown, mention contributors, react with emoji, clarify with attachments, and see references from commits, pull requests, releases, and deploys. Coordinate by assigning contributors and teams, or by adding them to milestones and projects. All in a single timeline.
Upload and attach videos to comments
Dive into work faster with issue forms and templates
Features
Bored of boards? Switch to tables and roadmaps. Create views for how you work.
Save views for sprints, backlogs, teams, or releases. Rank, group, sort, slice and filter to suit the occasion. Create swimlanes, share templates and set work in progress limits.
No mouse? No problem. Every action you can take with the mouse has a keyboard shortcut or command. Filter, sort, group, and assign issues. Your hands never leave the keyboard.
Custom fields
Track metadata like iterations, priority, story points, dates, notes, and links. Add custom fields to projects and edit from the issue sidebar.
Track progress with project insights
Track the health of your current iteration cycle, milestone, or any other custom field you create with new project insights. Identify bottlenecks and issues blocking the team from making progress with the new burn up chart.
Share best practices with project templates
Create templates to share and reuse when getting started with a new project. Share inspiration across teams and get started with a single click.
Manage work automatically
Accelerate your project planning with workflows. Automatically triage issues, set values for custom fields, or archive issues.
Manage work automatically
Issues, where you need them
Issues can be viewed, created, and managed in your browser, your favorite terminal, or on your phone or tablet.
GitHub CLI
View, update, and create issues without ever leaving your terminal.
Learn more
GitHub Mobile
Create and manage issues on the go with our native iOS and Android mobile apps.
Learn more
What developers are saying
“
The new planning and tracking functionality keeps my project management close to my code. I no longer find myself needing to reach for spreadsheets or 3P tools which go stale instantly.
Dan GodfreyDevelopment Manager
Flexible project planning for developers
Start using projectsContact sales
Frequently asked questions
What is GitHub Issues?
We all need a way to plan our work, track issues, and discuss the things we build. Our answer to this universal question is GitHub Issues, and it’s built-in to every repository. GitHub’s issue tracking is unique because of our focus on simplicity, references, and elegant formatting.
With GitHub Issues, you can express ideas with GitHub Flavored Markdown, assign and mention contributors, react with emojis, clarify with attachments and videos, plus reference code like commits, pull requests, and deploys. With task lists, you can break big issues into tasks, further organize your work with milestones and labels, and track relationships and dependencies.
We built GitHub Issues for developers. It is simple, adaptable, and powerful.
What are Projects?
As teams and projects grow, how we work evolves. Tools that hard-code a methodology are too specific and rigid to adapt to any moment. Often, we find ourselves creating a spreadsheet or pulling out a notepad to have the space to think. Then our planning is disconnected from where the work happens.
The new Projects connect your planning directly to the work your teams are doing and flexibly adapt to whatever your team needs at any point. Built like a spreadsheet, project tables give you a live canvas to filter, sort, and group issues and pull requests. You can use it, or the accompanying project board, along with custom fields, to track a sprint, plan a feature, or manage a large-scale release.
What plans have access to Projects?
All users have access to the free tier of GitHub Issues and Projects. For more information about paid tiers, see our pricing page.
Will the new Projects experience be available in GitHub Enterprise Server?
Yes! GitHub Enterprise Server (GHES) support follows our regular cadence of one to two quarters before enabling the on-premises functionality.
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/features/issues
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Ffeatures%2Fissues
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## GitHub Code Review · GitHub

- Source URL: https://github.com/features/code-review
- Crawl depth: 1

GitHub Code Review · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Features
GitHub Copilot
Security
Actions
Codespaces
Issues
Code review
Discussions
Code search
Code Review
Spend less time reviewing and more time shipping
Run GitHub Copilot for first-pass code reviews with actionable suggestions. Bring your team in for PR decisions that need a human eye.
Get started with GitHub CopilotLearn how Copilot code review works
The first review shouldn’t take the longest.
The first review shouldn’t take the longest.
Learn how Copilot code review works
Instant first pass. Receive structured, actionable feedback the moment a pull request is opened whether you assign it Copilot manually or configure it to review automatically.
Reviews that know your repo. Copilot works where your code already lives. It analyzes your full changeset across files, grounded in your repository and codebase, not generic best practices.
Customized to how your team builds. Define coding guidelines, extend Copilot with custom agent skills, or connect your own tools through MCP. Your standards, enforced on every PR, consistently and without reviewer fatigue.
Better together than either alone
Review bottlenecks slow teams down. Copilot takes the first pass so reviewers can focus on what matters most.
Copilot
Reviews the full changeset across files to flag bugs, security risks, and style issues. It suggests multi-line fixes you can apply in one click, comments directly on the lines that need attention, and can hand off suggestions to the Copilot cloud agent for autonomous resolution.
Your team
Brings architectural judgment, design perspective, and system context that only comes from building the software together. Your team mentors through discussion in the same thread, helps transfer knowledge, and owns final approval and accountability.
Review that reasons, remembers and adapts
Copilot reasons across files, learns your team’s conventions, and integrates with your existing toolchain.
Agentic code review
Copilot follows the logic of your change across functions and files, understands the intent behind it, and surfaces issues that line-by-line analysis would miss.
Learn more
Reviews grounded in your codebase
Copilot can draw on custom instructions and Copilot Memory to understand your project's conventions, architecture, and context, so feedback reflects how your team actually builds.
Learn more
Extensible to your workflow
Build custom agent skills or connect your own tools through MCP to tailor what Copilot reviews and how. Your standards, your tools, your way of working.
Learn more
Code review is how your team thinks together
It’s where your team shares knowledge, makes design decisions, and builds shared ownership of the codebase.
Learn more about PR reviews
Have the conversation where the code is
Keep discussion and feedback right next to the diffs so it's easier to stay in context while reviewing your PR.
Get the right eyes on every change
Route pull requests to the right people with review requests and code owners.
Understand the full picture
Rich diffs, blame, and commit history show what changed, who changed it, and why.
Code doesn’t merge until it’s ready
Fast, relevant results
Set a minimum number of approving reviews, whether Copilot or human, before any pull request can merge.
Learn more
Protected branches
Control how code gets merged. Restrict who can push, require linear history, and prevent force pushes.
Learn more
Required status checks
Ensure CI passes, tests are green, and automated gates clear before the merge button is enabled.
Learn more
Better reviews on every pull request
Start reviewing code with Copilot and your team today.
Get started with GitHub CopilotLearn how Copilot code review works
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/features/code-review
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Ffeatures%2Fcode-review
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## GitHub Advanced Security · Built-in protection for every repository · GitHub

- Source URL: https://github.com/security/advanced-security
- Crawl depth: 1

GitHub Advanced Security · Built-in protection for every repository · GitHub
Skip to content
GitHub Universe 2026
Save $600 with Super Early Bird passes through July 8.
Register now
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
GitHub Security
Advanced Security
Secret Protection
Code Security
Supply Chain Security
Plans & pricing
GitHub Advanced Security
Security that moves at the speed of development
Request a demoSee plans & pricing
Stop leaks before they start
Explore Secret Protection
Fix vulnerabilities in your code
Explore Code Security
/security/advanced-security logos
Become a risk reduction warrior
Stay ahead of threats with built-in security, secret protection, and dependency monitoring.
Write secure code at scale with AI-driven insights and automated fixes from GitHub Copilot Autofix.
Strengthen your development with AI
Find and fix vulnerabilities in real time by integrating application security right into GitHub.
Empower your team with native AppSec
“
GitHub Advanced Security has solved the risk of leaked credentials. Now, developers are alerted to the problem before they push the code live. They have a direct feedback loop.
Florian KochLead developer at Deutsche Vermögensberatung
Two layers of powerful protection
Combine Secret Protection and Code Security to safeguard your code from every angle.
See plans & pricing
Add-on
GitHub Secret Protection
For teams and organizations serious about stopping secret leaks.
$19USD
per active committer/month
Request a demoContact sales
Ready to use it in your repositories?
Get started now
Add-on
GitHub Code Security
For teams and organizations committed to fixing vulnerabilities before production.
$30USD
per active committer/month
Request a demoContact sales
Ready to use it in your repositories?
Get started now
Get the most out of GitHub Advanced Security
Discover how our security solution can benefit your organization.
Request a demo
Explore the benefits of improving software security standards in organizations.
Read the Forrester Report
Learn how industry experts protect their code without sacrificing productivity.
Explore videos
Frequently asked questions
What is GitHub Advanced Security?
GitHub Advanced Security (GHAS) encompasses GitHub’s application security products comprising GitHub Secret Protection and GitHub Code Security. GHAS adds cutting-edge tools for static analysis, software composition analysis, and secret scanning to the GitHub platform that developers already know and love. GHAS makes it easy for developers to find and fix vulnerabilities earlier in the software development life cycle.
Why choose GitHub Advanced Security instead of a third-party AppSec product?
GitHub Advanced Security operates entirely in the native GitHub workflows that developers already know and love. By making it easier for developers to remediate vulnerabilities as they go, GitHub Advanced Security frees time for security teams to focus on critical strategies that protect businesses, customers, and communities from application-based vulnerabilities.
What is DevSecOps?
DevSecOps refers to a combination of the development, security, and operations tools necessary to develop software applications.
What is AppSec?
Application security (AppSec) is the process of finding, fixing, and preventing security vulnerabilities in applications. GitHub Advanced Security provides AppSec tools for static application security testing (SAST), which identifies vulnerabilities in the code itself.
Can I use GitHub Advanced Security with Microsoft Azure DevOps?
Yes. GitHub Advanced Security is available as an add-on for Azure DevOps.
Where can I find case studies and reference customers?
Read our customer stories to learn how customers like Telus, Mercado Libre, and KPMG use GitHub Advanced Security to secure applications and accelerate the software development lifecycle.
Can I review documentation before purchase?
Yes. As with all GitHub products, documentation for GitHub Advanced Security is publicly available.
Does GitHub offer consulting, training, and other deployment services?
Yes! Please visit Expert Services to learn more.
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/security/advanced-security
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fsecurity%2Fadvanced-security
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## GitHub Code Security · GitHub

- Source URL: https://github.com/security/advanced-security/code-security
- Crawl depth: 1

GitHub Code Security · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
GitHub Security
Advanced Security
Secret Protection
Code Security
Supply Chain Security
Plans & pricing
GitHub Code Security
Application security where found means fixed
Secure your code as you build with GitHub Code Security. Detect vulnerabilities early and fix them with Copilot Autofix.
Request a demoSee plans & pricing
What is GitHub code security?
28 min From vulnerability detection to remediation
3X Faster remediation on average with Copilot Autofix
90% Of alert types include AI-powered code suggestions
Detect and remediate vulnerabilities
early with AI-powered fixes
Automate security checks
Find security issues in real time with CodeQL’s powerful analysis that traces data flows throughout your application.
Learn more about CodeQL
Remediate at scale
Get contextual explanations and AI-powered fixes for CodeQL-detected alerts with Copilot Autofix.
Explore Copilot Autofix
Reduce security debt
GitHub Code Security continuously scans your code as you build, helping detect vulnerabilities early, fix them fast with Copilot Autofix, and ship securely.
Catch risks early
Identify new dependencies and check for vulnerabilities or license issues with the Dependency Review Action.
Explore the Dependency Review Action
One-click risk assessment
Evaluate exposure to application vulnerabilities and leaked secrets in your codebase with our free risk assessment tool.
Try it now
“
Copilot Autofix streamlines security by flagging vulnerabilities and suggesting fixes instantly, keeping code secure while freeing teams for strategic work.”
Mario Landgrafcommunity manager of security at Otto GmbH & Co. KGaA
Build secure software from day one
Security should be built in, not bolted on. With Code Security, you can find, fix, and prevent vulnerabilities seamlessly—keeping your software resilient from development to deployment.
Request a demoSee plans & pricing
Best practices for more secure software
Discover developer-first security
Take an in-depth look at the current state of application security.
View the webinar
Explore the DevSecOps guide
Learn how to write more secure code from the start with DevSecOps.
Read the whitepaper
Avoid AppSec pitfalls
Explore common application security pitfalls and how to avoid them.
Read the whitepaper
FAQs
What is Code Security?
GitHub Code Security empowers developers to secure their code without sacrificing speed. With built-in static analysis, AI-powered remediation, advanced dependency scanning, and proactive vulnerability management, teams can automatically detect, prioritize, and remediate security issues, all within their existing GitHub workflow—allowing them to deliver secure software faster and with greater confidence
What is Copilot Autofix?
Copilot Autofix uses AI-powered code suggestions to automatically fix security vulnerabilities identified by CodeQL. When a security vulnerability is detected, Copilot Autofix analyzes the code context, understands the underlying security issue, and generates a precise, contextually appropriate fix. This feature bridges the gap between vulnerability detection and remediation, enabling developers to review and apply AI-suggested fixes directly within their workflow.
What are Security Campaigns?
Security campaigns provide a structured framework for planning, tracking, and implementing security fixes across multiple repositories and teams allowing you to systematically burn down security debt. With With security campaigns, security teams can group related vulnerabilities, prioritize remediation efforts, assign ownership, and monitor progress through a unified dashboard. Security campaigns can be organized by vulnerability type, security initiative, compliance requirement, or any other logical grouping to coordinate security improvements at scale.
What is dependency analysis?
Dependency review scans pull requests for vulnerable dependencies before they're introduced into your codebase. It evaluates the security impact of dependency changes, identifying vulnerable packages and their severity levels to prevent security issues from being merged. The tool shows detailed dependency changes by comparing the base and head branches, highlighting added, removed, and updated dependencies along with their known vulnerabilities
What is EPSS?
Dependabot alerts now feature the Exploit Prediction Scoring System (EPSS) from the global Forum of Incident Response and Security Teams (FIRST), helping better assess vulnerability risks. EPSS helps organizations prioritize vulnerability remediation by predicting the likelihood of a vulnerability being exploited in the next 30 days. It provides a score ranging from 0 to 1 (0-100%), alongside a percentile ranking to indicate how the vulnerability compares to others.
What is the code security risk assessment?
The Code Security Risk Assessment is a free evaluation that analyzes repositories to identify potential code-level vulnerabilities and highlight areas where GitHub Code Security can help improve security posture.
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/security/advanced-security/code-security
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fsecurity%2Fadvanced-security%2Fcode-security
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## GitHub Secret Protection · GitHub

- Source URL: https://github.com/security/advanced-security/secret-protection
- Crawl depth: 1

GitHub Secret Protection · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
GitHub Security
Advanced Security
Secret Protection
Code Security
Supply Chain Security
Plans & pricing
GitHub Secret Protection
Keep your secrets secret
GitHub Secret Protection continuously monitors your GitHub perimeter, helping prevent exposures, protect credentials, and ship securely.
Request a demoSee plans & pricing
What is GitHub Secret Protection?
4.4M Secrets prevented from leaking on GitHub in 2024
150+ Industry partners, working together to mitigate risk for the developer community
39M Secret leaks detected with Secret Protection in 2024
Prevent accidental secret exposure
across your repositories
Block leaks before they happen
Push protection automatically blocks secrets before they reach your repository, keeping code clean without disrupting workflows.
Find the threats that others miss
Detect secrets in issues, discussions, and more with secret scanning. Metadata like validity checks and public leaks help prioritize active threats.
Give Copilot the heavy lifting
GitHub Copilot finds elusive secrets like passwords without the false positives. It detects secrets that traditional secret detectors are less likely to catch, providing an additional layer of security.
Standardize enforcement, simplify compliance
Manage policies like delegated bypass for push protection, alert dismissal restrictions, and built-in enablement configurations, simplifying security enforcement at scale.
Powered by a global security partnership
GitHub partners with 150+ providers to mitigate risks and ensure the highest level of detection accuracy.
Learn about the secret scanning partner program
Safer code for everyone
Whether you're securing an open source project or strengthening your enterprise codebase, Secret Protection helps you keep secrets out of your code.
Request a demoSee plans & pricing
Resources to get started
Discover developer-first application security
Take an in-depth look at the current state of application security.
View the webinar
Explore the DevSecOps guide
Learn how to build security into your code from day one with DevSecOps.
Read the whitepaper
Avoid AppSec pitfalls
Explore common application security pitfalls and how to avoid them.
Read the whitepaper
FAQs
What is GitHub Secret Protection?
GitHub Secret Protection detects and prevents secret leaks continuously in real-time, proactively blocking sensitive credentials from being pushed to a repository with push protection. With a remarkably low false positive rate and approximately 150 service provider integrations, it enables rapid credential revocation and rotation, enhancing developer productivity.
What is the secret risk assessment?
The secret risk assessment provides a free, comprehensive overview of an organization’s secret leak footprint across its GitHub repositories. By analyzing repositories for exposed secrets, it helps admins and developers understand their exposure to potential security risks and offers actionable insights for remediation.
What is push protection?
Push protection is designed to prevent sensitive information, such as secrets or tokens, from being pushed to your repository in the first place. It proactively scans your code for secrets during the push process and blocks the push if any are detected.
What is delegated bypass for push protection?
Delegated bypass introduces an approval process for developers to bypass push protection. Anyone opting to bypass a push protection block will need to submit a request to a designated group of reviewers, ensuring any risky secrets are not accidentally leaked.
What are secret scanning validity checks?
Validity checks help you determine whether detected secrets are still active, enabling developers and security teams to prioritize their response effectively. When a secret is flagged, the system verifies its validity to confirm whether the secret is active or inactive.
What is the secret scanning partnership program?
The secret scanning partnership program allows service providers to secure their token formats by enabling GitHub to scan public repositories and npm packages for exposed secrets. When a secret is found in a public repo, GitHub sends an alert directly to the service provider, who can then validate and take appropriate action.
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/security/advanced-security/secret-protection
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fsecurity%2Fadvanced-security%2Fsecret-protection
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## GitHub · Why Choose GitHub? · GitHub

- Source URL: https://github.com/why-github
- Crawl depth: 1

GitHub · Why Choose GitHub? · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Why GitHub
Most of the world's code lives on GitHub. Why not yours?
GitHub empowers developers and enterprises to collaborate, innovate, and build securely. With AI-powered tools, built-in security testing, and seamless integration, it supports teams from first commit to enterprise development.
Start free for 30 daysContact sales
What is GitHub?
Over 90% of Fortune 100 companies and more than 150 million developers rely on GitHub to deliver scalable, reliable, and secure solutions for teams of all sizes.
Developer-first: Designed for developers, GitHub offers seamless collaboration tools that make teamwork smarter, faster, and more secure.
Enterprise-grade: GitHub Enterprise scales with your organization, delivering the performance and security needed for teams of any size.
AI-powered: Leverage GitHub Copilot to automate tasks and enhance productivity with smart, context-aware code suggestions.
Logos for Fidelity Shopify Mercedes Benz American Airlines Adobe Ford Vodafone Spotify Home Depot
The developer platform that grows with you
Whether you're a small startup or a global enterprise, GitHub is designed to grow with you. The platform adapts to your needs, helping ensure that you don’t have to compromise on performance, security, or collaboration as your organization scales.
Explore GitHub Enterprise
Customizable workflows
Tailor your workflows with GitHub Actions and integrate seamlessly with your existing tools.
Learn more about GitHub Actions
Security at scale
GitHub's centralized access management and compliance tools help ensure your code and data remain safe.
Explore GitHub security
Your code, your control
With GitHub Enterprise Cloud, you decide where your code lives while enabling security, compliance, and scalability with SaaS agility and enterprise-grade governance.
Read about data residency
55% faster coding enabled by GitHub Copilot
80% time saved in developer onboarding
$3.2M in savings by reducing developer onboarding training time through automation
75% improvement in time spent managing tools and code infrastructure
Security throughout the SDLC
Fix vulnerabilities before they hit production and reduce the risk of a costly breach with application security that is built in, not bolted on.
Explore GitHub Advanced Security
Code security
Review potential vulnerabilities and get suggested fixes with Copilot Autofix to accelerate remediation and strengthen security posture.
Learn more about Copilot Autofix
Secret protection
Help ensure your secrets stay secure by preventing accidental exposure in your repositories.
Check out GitHub Secret Protection
Supply chain security
Visualize, protect, and remediate your code's upstream dependencies.
Explore GitHub supply chain security
3x faster remediation on average with Copilot Autofix
28 min from vulnerability detection to successful remediation
4.4M secrets prevented from being leaked on GitHub in 2024
The comprehensive platform
for high-performance teams
GitHub is where the world builds software—faster, smarter, and more securely. Unlock the full potential of your team with an AI-native platform, seamless automation, and CI/CD workflows that help you build, scale, and innovate like never before.
Explore CI/CD solution
Speed up your workflows and eliminate bottlenecks
Harness GitHub Copilot to automate tasks, enhance code quality, and boost productivity. With intelligent, adaptive recommendations, you’ll write cleaner code quicker and accomplish more in less time.
See GitHub Copilot
Get your team in sync, effortlessly
With GitHub’s integrated tools—from pull requests to project boards—collaboration is streamlined, and automation handles the heavy lifting. Keep your team aligned, reduce manual tasks, and stay focused on building great software.
Learn more about GitHub Issues
Work smarter, build faster, innovate with intention
GitHub introduces new ways to work smarter and faster. With AI-powered tools and agentic automation, you can reduce repetitive tasks and stay in a flow state—shaping the future of software with speed and intention.
Explore GitHub Copilot agent mode
“
Between Copilot, Codespaces, Issues, Actions, and Dependabot, GitHub is at the center of our development universe. It has enabled us to increase the velocity of our development and has shortened our time-to-market.
Luigi UngaroGlobal Engine developer lead, Amplifon
The platform developers know and love
Empower your team to collaborate, innovate, and build software—faster, smarter, and more securely—with the platform they know and love.
Start free for 30 daysContact sales
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/why-github
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fwhy-github
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## GitHub Features · GitHub

- Source URL: https://github.com/features
- Crawl depth: 1

GitHub Features · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Features
GitHub Copilot
Security
Actions
Codespaces
Issues
Code review
Discussions
Code search
The tools you need to build what you want
Experience AI with Copilot Chat
Learn more
The latest GitHub previews
Learn more
Anchor navigation menu. Currently selected:
Collaborative codingAutomation & CI/CDApplication securityClient appsProject management
Collaborative Coding
/features Flex - Collaborative Coding - River Breakout
Innovate faster with seamless collaboration.
See the changes you care about.
Build community around your code.
GitHub Codespaces
Spin up fully configured dev environments in the cloud with the full power of your favorite editor.
Learn more
GitHub Copilot
Get suggestions for whole lines of code or entire functions right inside your editor.
Learn more
Pull requests
Receive notifications of contributor changes to a repository, with specified access limits, and seamlessly merge accepted updates.
Learn more
Discussions
Dedicated space for your community to come together, ask and answer questions, and have open-ended conversations.
Learn more
Code search & code view
Rapidly search, navigate, and understand code right from GitHub.com with our powerful new tools.
Learn more
Code review
Review new code, visualize changes, and merge confidently with automated status checks.
Learn more
Draft pull requests
Collaborate and discuss changes without a formal review or the risk of unwanted merges.
Learn more
Protected branches
Enforce branch merge restrictions by requiring reviews or limiting access to specific contributors.
Learn more
Automation and CI/CD
/features Flex - Automation and CI/CD - River Breakout
Automate everything: CI/CD, testing, planning, project management, issue labeling, approvals, onboarding, and more
Standardize and scale best practices, security, and compliance across your organization.
Get started quickly with thousands of actions from partners and the community.
GitHub Actions
Automate your software workflows by writing tasks and combining them to build, test, and deploy faster from GitHub.
Learn more
GitHub Packages
Host your own software packages or use them as dependencies in other projects, with both private and public hosting available.
Learn more
APIs
Create calls to get all the data and events you need within GitHub, and automatically kick off and advance your software workflows.
Learn more
GitHub Marketplace
Leverage thousands of actions and applications from our community to help build, improve, and accelerate your workflows.
Learn more
Webhooks
Dozens of events and a webhooks API help you integrate with and automate work for your repository, organization, or application.
Learn more
GitHub-hosted runners
Move automation to the cloud with on-demand Linux, macOS, Windows, ARM, and GPU environments for your workflow runs, all hosted by GitHub.
Learn more
Self-hosted runners
Gain more environments and fuller control with labels, groups, and policies to manage runs on your own machines, plus an open source runner application.
Learn more
Workflow visualization
Map workflows, track their progression in real time, understand complex workflows, and communicate status with the rest of the team.
Learn more
Workflow templates
Standardize and scale best practices and processes with preconfigured workflow templates shared across your organization.
Learn more
Application security
Application security where found means fixed. Powered by GitHub Copilot Autofix.
Application security where found means fixed. Powered by GitHub Copilot Autofix.
Explore GitHub Advanced Security
Prevent, find, and fix application vulnerabilities and leaked secrets.
Target historical alerts to reduce security debt at scale.
Built into the GitHub platform that developers know and love.
Code scanning
Find vulnerabilities in your code with CodeQL, GitHub’s industry-leading semantic code analysis. Prevent new vulnerabilities from being introduced by scanning every pull request.
Learn more
GitHub Copilot Autofix
Powered by GitHub Copilot, generate automatic fixes for 90% of alert types in JavaScript, TypeScript, Java, and Python. Quickly remediate with contextual vulnerability intelligence and advice.
Learn more
Security campaigns
Solve your backlog of application security debt with security campaigns that target and generate autofixes for up to 1,000 alerts at a time, rapidly reducing the risk of vulnerabilities and zero-day attacks.
Learn more
Secret scanning
Detect exposed secrets in your public and private repositories, and revoke them to secure access to your services.
Learn more
GitHub Copilot secret scanning
Additional AI capabilities to detect elusive secrets like passwords.
Learn more
Dependency graph
View the packages your project relies on, the repositories that depend on them, and any vulnerabilities detected in their dependencies.
Learn more
Dependabot alerts
Receive alerts when new vulnerabilities affect your repositories, with GitHub detecting and notifying you of vulnerable dependencies in both public and private repositories.
Learn more
Dependabot security and version updates
Keep your code secure by automatically opening pull requests that update vulnerable or out-of-date dependencies.
Learn more
Dependency review
Assess the security impact of new dependencies in pull requests before merging.
Learn more
GitHub security advisories
Privately report, discuss, fix, and publish information about security vulnerabilities found in open source repositories.
Learn more
Private vulnerability reporting
Enable your public repository to privately receive vulnerability reports from the community and collaborate on solutions.
Learn more
GitHub Advisory Database
Browse or search GitHub's database of known vulnerabilities, featuring curated CVEs and security advisories linked to the GitHub dependency graph.
Learn more
Client apps
Access GitHub anywhere: On Desktop, Mobile, and Command Line.
Access GitHub anywhere: On Desktop, Mobile, and Command Line.
Accessible anywhere. Use GitHub on macOS, Windows, mobile, or tablet with native apps.
Efficient management. Handle pull requests, issues, and tasks swiftly with GitHub CLI or mobile.
Streamlined development. Visualize and commit changes easily with GitHub Desktop.
GitHub Mobile
Take your projects, ideas, and code to go with fully native mobile and tablet experiences.
Learn more
GitHub CLI
Manage issues and pull requests from the terminal, where you're already working with Git and your code.
Learn more
GitHub Desktop
Simplify your development workflow with a GUI to visualize, commit, and push changes—no command line needed.
Learn more
Project management
Keep feature requests, bugs, and more organized.
Keep feature requests, bugs, and more organized.
Coordinate initiatives big and small with project tables, boards, and task lists.
Engineered for software teams.
Track what you deliver down to the commit.
GitHub Projects
Create a customized view of your issues and pull requests to plan and track your work.
Learn more
GitHub Issues
Track bugs, enhancements, and other requests, prioritize work, and communicate with stakeholders as changes are proposed and merged.
Learn more
Milestones
Track progress on groups of issues or pull requests in a repository, and map groups to overall project goals.
Learn more
Charts and insights
Leverage insights to visualize your projects by creating and sharing charts built from your project's data.
Learn more
Org dependency insights
View vulnerabilities, licenses, and other important information for the open source projects your organization depends on.
Learn more
Repository insights
Use data about activity, trends, and contributions within your repositories, to make data-driven improvements to your development cycle.
Learn more
Wikis
Host project documentation in a wiki within your repository, allowing contributors to easily edit it on the web or locally.
Learn more
Governance & administration
Simplify access and permissions management across your projects and teams.
Simplify access and permissions management across your projects and teams.
Update permissions, add new users as you grow, and assign everyone the exact permissions they need.
Sync with Okta and Entra ID.
Organizations
Create groups of user accounts that own repositories and manage access on a team-by-team or individual user basis.
Learn more
Teams
Organize your members to mirror your company's structure, with cascading access to permissions and mentions.
Learn more
Team sync
Enable team synchronization between your identity provider and your organization on GitHub, including Entra ID and Okta.
Learn more
Custom roles
Define users' access level to your code, data, and settings based on their role in your organization.
Learn more
Custom repository roles
Ensure members have only the permissions they need by creating custom roles with fine-grained permission settings.
Learn more
Domain verification
Verify your organization's identity on GitHub and display that verification through a profile badge.
Learn more
Compliance reports
Take care of your security assessment and certification needs by accessing GitHub’s cloud compliance reports, such as our SOC reports and Cloud Security Alliance CAIQ self-assessments (CSA CAIQ).
Learn more
Audit log
Quickly review the actions performed by members of your organization. Monitor access, permission changes, user changes, and other events.
Learn more
Repository rules
Enhance your organization's security with scalable source code protections, and use rule insights to easily review how and why code changes occurred in your repositories.
Learn more
Requires GitHub Enterprise
Enterprise accounts
Enable collaboration between your organization and GitHub environments with a single point of visibility and management via an enterprise account.
Learn more
Requires GitHub Enterprise
GitHub Connect
Share features and workflows between your GitHub Enterprise Server instance and GitHub Enterprise Cloud.
Learn more
Requires GitHub Enterprise
SAML
Securely control access to organization resources like repositories, issues, and pull requests with SAML, while allowing users to authenticate with their GitHub usernames.
Learn more
Requires GitHub Enterprise
LDAP
Centralize repository management. LDAP is one of the most common protocols used to integrate third-party software with large company user directories.
Learn more
Requires GitHub Enterprise
Enterprise Managed Users
Manage the lifecycle and authentication of users on GitHub Enterprise Cloud from your identity provider (IdP).
Learn more
Requires GitHub Enterprise
Bring your own identity provider for Enterprise Managed Users
Use the SSO and SCIM providers of your choice for Enterprise Managed Users, separate from one another, for a more flexible approach to user lifecycle management.
Learn more
Community
Community
GitHub Sponsors
Financially support the open source projects your code depends on. Sponsor a contributor, maintainer, or project with one time or recurring contributions.
Learn more
GitHub Skills
Learn new skills by completing tasks and projects directly within GitHub, guided by our friendly bot.
Learn more
Electron
Write cross-platform desktop applications using JavaScript, HTML, and CSS with the Electron framework, based on Node.js and Chromium.
Learn more
Education
GitHub Education is a commitment to bringing tech and open source collaboration to students and educators across the globe.
Learn more
Ready to get started?
Explore all the plans to find the solution that fits your needs.
View pricing plansContact sales
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/features
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Ffeatures
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## GitHub Enterprise · The AI-powered developer platform for the agent-ready enterprise · GitHub

- Source URL: https://github.com/enterprise
- Crawl depth: 1

GitHub Enterprise · The AI-powered developer platform for the agent-ready enterprise · GitHub
Skip to content
GitHub Universe 2026
Save $600 with Super Early Bird passes through July 8.
Register now
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Enterprise
Advanced Security
Premium Support
The AI-powered developer platform for the agent-ready enterprise
Bring your DevOps together on one secure platform built for speed, scale, and the agent-driven future of software.
Start a 30-day free trialContact sales
/enterprise Section - logo
Enterprise-grade by design
A centrally governed foundation that provides the control and visibility you need to innovate securely at scale.
Security built into every stage of the software lifecycle
Security built into every stage of the software lifecycle. GitHub integrates automated, developer-first security that keeps teams moving fast.
Find and fix vulnerabilities natively. Automate code, secret, and dependency scanning with GitHub Advanced Security, built directly into the workflow.
Secure your software supply chain. Visualize and maintain the dependencies in your software supply chain.
Control the location of your code. Enjoy SaaS agility with enhanced governance, security, and flexible data residency.
Built for your most valuable asset:
your developers
GitHub transforms your engineering team into a high-performing, AI-powered force for innovation and growth.
The complete development workflow, end to end
Bring every stage of the development lifecycle together on one secure platform.
Explore all features
Scale your talent with GitHub Copilot
Go beyond code completion with AI that improves quality and problem-solving and fuels innovation.
Explore Copilot for Business
Hit the ground coding
Skip the ramp-up and accelerate impact with the platform trusted by over 180 million developers.
Read the Octoverse 2025 report
Flexibility to build your way
Tap into our ecosystem of apps, actions, and models to accelerate innovation.
Explore the GitHub Marketplace
From reactive administration to strategic platform leadership.
From reactive administration to strategic platform leadership. Take control with centralized governance and automation that scales with your enterprise.
Manage multiple orgs from one place. Create and assign custom roles and teams to streamline management across your enterprise.
Define and enforce policies. Apply consistent, non-overridable rulesets across every repository in your enterprise.
Take command of your AI agents. See and control every agent and action from a single dashboard.
Adopted by the world's leading organizations
Mercado Libre developers code 50% faster with GitHub Copilot
Read customer story
Wayfair migrates 15,000 repositories to GitHub, saving $150,000 a year
Read customer story
TELUS saves $16.9 million by unifying DevOps on GitHub
Read customer story
Start your journey with GitHub
Whether you’re a startup or Fortune 500, GitHub Enterprise gives you everything you need to innovate securely on the platform developers love.
Start a 30-day free trialContact sales
Get the most out of GitHub Enterprise
Get executive insights built for leaders and admins
Learn more
Stay ahead with our quarterly product roadmap webinar
See what's new
Accelerate adoption with proven guidance
Discover GitHub’s framework
See the cost savings and ROI of GitHub Enterprise Cloud
Get the Forrester® Total Economic Impact™ study
Discover why GitHub leads the Forrester Wave™ for DevOps platforms
Read the report
Explore the full documentation for GitHub Enterprise Cloud
View the docs
Frequently asked questions
About GitHub Enterprise
What is GitHub Enterprise?
GitHub Enterprise is an enterprise-grade software development platform designed for the complex workflows of modern development.
As an extensible platform solution, GitHub Enterprise enables organizations to seamlessly integrate additional tools and functionalities, tailoring their development environment to meet specific needs and enhancing overall productivity.
Why should organizations use GitHub Enterprise
There are several reasons why organizations should consider using GitHub Enterprise:
Accelerate development at scale with AI-powered development: GitHub is the world’s most widely adopted Copilot-powered developer platform helping organizations build, secure, and deliver innovative software at scale.
Application security made simpler: Native security tools embedded into the developer workflow, such as GitHub Advanced Security, help developers easily fix security issues, while providing more visibility and controls.
Centralize governance and compliance: Customers can access a range of administration features to help manage governance at scale and enforce business rules and policies to meet their specific needs.
Boost productivity and collaboration: Increase productivity with automated CI/CD workflows using GitHub Actions, collaborate effectively with GitHub Projects and GitHub Issues, manage hosted packages with GitHub Packages, and utilize prebuilt and configured development environments with GitHub Codespaces.
Greater flexibility and control over data: Whether self-hosting with GitHub Enterprise Server or using GitHub Enterprise Cloud, GitHub provides customers with flexibility and control over their data. And now with GitHub Enterprise Cloud with data residency, customers have enhanced control where certain data, like their code, resides. Start a free 30 day trial today or contact our sales team for more information.
Who uses GitHub Enterprise?
GitHub Enterprise is used by organizations of all sizes that require greater productivity, collaboration, and security capabilities for their software development process. GitHub Enterprise can scale with teams, all the way from a small startup to a large corporation.
What is GitHub Enterprise Cloud?
GitHub Enterprise Cloud is the cloud-based solution of GitHub Enterprise, hosted on GitHub’s servers. This eliminates the need for organizations to maintain their own servers, infrastructure, and updates, allowing them to focus on development.
In addition to the core productivity and collaboration features it provides, GitHub Enterprise Cloud provides access to additional features and add-ons for security, support, managed users, and many more.
Customers can easily add or remove users as needed, and they can also increase storage capacity or processing power as their needs change.
And for customers desiring more control over their data, GitHub Enterprise Cloud with data residency provides improved enterprise-grade features and more control over where code is stored. Start a free 30 day trial today or contact our sales team for more information.
What is GitHub Enterprise Server?
GitHub Enterprise Server is the self-hosted version of GitHub Enterprise. It is installed on-premises or on a private cloud and provides organizations with a secure and customizable source code management and collaboration platform.
One of the key advantages of GitHub Enterprise Server is that it provides organizations with complete control over their source code and data. Organizations can choose where to store their repositories and can control who has access to them. Administrators can also customize the platform to meet specific needs, such as integrating other tools or implementing custom workflows.
GitHub Enterprise Server also offers enhanced security and compliance features. Organizations can configure their instance to meet their specific security requirements, such as using LDAP or SAML for authentication, setting up two-factor authentication, or implementing network security measures. Compliance features are also included, such as audit logs, access controls, and vulnerability scanning.
How secure is GitHub Enterprise?
GitHub Enterprise is designed with security in mind and includes a range of features to help organizations protect their code and data. Here are some of the key security features that GitHub Enterprise offers:
Authentication and access controls: GitHub Enterprise includes two-factor authentication, LDAP and Active Directory integration, and OAuth authentication. This helps organizations ensure that only authorized users can access their repositories and data.
Encryption: All data in transit between the user's computer and GitHub Enterprise server is encrypted using HTTPS. All data at rest uses AES-256 encryption.
Vulnerability scanning: GitHub Enterprise includes built-in security scanning features that can detect known vulnerabilities and alert users.
Audit logs: The platform provides detailed audit logs that record all user actions, including repository access, changes, and deletions. This helps organizations track and monitor user activity and identify potential security issues.
Customizable policies: GitHub Enterprise allows organizations to create custom policies for repository access. This can help enforce compliance requirements and prevent unauthorized access to sensitive data.
Regular security updates: There is also a dedicated security team that provides regular updates, monitors for potential security threats, and responds quickly to any issues that arise.
Is GitHub Enterprise free?
No, GitHub Enterprise is not free. It is a paid product that can be paid for either as a metered service on a monthly basis or as a subscription, with the cost determined by the number of users and the level of support required. For organizations interested in trying out the platform before making a commitment, GitHub Enterprise offers a free trial. Furthermore, organizations can contact the GitHub Sales team for the option to request a custom quote to meet their specific needs.
Using GitHub Enterprise
How can developers collaborate with GitHub Enterprise?
Developers can collaborate with GitHub Enterprise using a variety of tools that are built into the platform, including:
Pull requests: Allows developers to propose changes to a repository and submit them for review. Other team members can review the changes, leave comments, and suggest further improvements.
GitHub Projects: Enables developers to track issues, assign tasks, and prioritize work. This helps teams stay on track, identify and resolve issues quickly, and ensure that everyone is working towards the same goals.
GitHub Discussions: Empowers developers to have conversations about specific topics. This can be particularly useful for triaging complex issues or making decisions about the direction of a project.
Can I migrate a repo from Azure DevOps to GitHub Enterprise without disrupting Azure Boards or Pipelines?
Yes. You can migrate a repo from Azure DevOps to GitHub Enterprise without disruption. Start by migrating a single "pilot" repository to validate the benefits of agentic DevOps. You can run GitHub alongside your existing Azure DevOps projects and migrate at your own pace.
Choosing your plan
How can organizations get started with GitHub Enterprise?
To get started with GitHub Enterprise, try a free trial today or contact our sales team.
What GitHub Enterprise plans are available?
GitHub Enterprise offers several plans that vary in price and features. They are designed to accommodate different types of organizations and teams, from small startups to large enterprises. These plans include:
GitHub Enterprise Server: This is the self-hosted version of GitHub Enterprise. It is installed on-premises or on a private cloud, and offers all the features of the cloud-based version of GitHub, including pull requests, code reviews, and project management tools. Pricing depends on the number of users and support requirements.
GitHub Enterprise Cloud: This is the cloud-based version of GitHub Enterprise. It is hosted on GitHub's servers, and it offers all the features of GitHub Enterprise Server. The price depends on the number of users and storage requirements.
How much does GitHub Enterprise cost?
For more information on cost, please see our pricing page.
Getting started with enterprise software development platforms
What is a DevOps platform?
A DevOps platform is a set of tools, technologies, and practices that enable software development and IT operations teams to collaborate and automate the software delivery process. It typically includes version control, continuous integration and continuous delivery (CI/CD), automated testing, deployment automation, and monitoring.
The main goal of a DevOps platform is to provide a single environment for software development and IT operations teams. By automating the software delivery process, a DevOps platform helps organizations reduce the time and cost of delivering software, while also improving the reliability, security, and scalability of their applications.
What is developer experience?
Developer experience (DevEx) refers to the overall experience that software developers have when using development tools, frameworks, and platforms to create software applications. It encompasses all aspects of a developer's interaction with the tools, including onboarding, maintaining, ease of use, and productivity.
The goal of optimizing DevEx is to make it as easy as possible for developers to create high-quality software quickly. This can involve designing tools with intuitive interfaces, providing clear and concise documentation, seamlessly integrating tools into workflows, and offering comprehensive support to help developers overcome challenges and obstacles.
By prioritizing DevEx, organizations can improve the speed and quality of their software development processes, increase developer satisfaction and retention, and ultimately deliver better products.
What is a software development platform?
A software development platform is a set of tools, technologies, and resources that enable software developers to create, test, deploy, and maintain software applications. This typically includes a programming language or framework, an integrated development environment (IDE), libraries, code repositories, debugging and testing tools, and deployment and hosting options.
The goal of a software development platform is to provide developers with a comprehensive set of tools and resources that make it easier to develop high-quality software. By providing an integrated environment for software development, a software development platform can help developers streamline their workflows, reduce errors, and improve the speed and quality of their work. Additionally, many software development platforms also provide access to a community of developers who can offer support, advice, and resources for improving software development practices.
What is an application development platform?
An application development platform is a set of tools that enables developers to build, deploy, and manage custom software applications.
This kind of platform typically includes a programming language, software development kits (SDKs), application programming interfaces (APIs), libraries, and testing and debugging tools.
These tools are designed to make it easier for developers to create and deploy custom applications for a specific platform, such as a mobile device or web browser.
The goal of an application development platform is to provide developers with a comprehensive set of tools that makes it easier to create high-quality applications that meet the specific requirements of a particular platform or device.
What is software development collaboration?
Software development collaboration is the process of working together as a team to create, test, and deploy software applications. It can involve a range of activities, such as brainstorming, planning, code reviews, testing, and deployment. Collaboration is an essential component of the software development process, as it allows multiple developers and stakeholders to work together.
Effective collaboration requires open communication, clear goals and objectives, shared resources, and a commitment to working together as a team. Collaboration tools such as version control systems, collaborative coding environments, and project management software, can also provide a centralized location for team members to share information, coordinate tasks, and track progress.
Ultimately, software development collaboration is essential to creating high-quality software that’s reliable, scalable, and meets the needs of end-users and stakeholders.
About GitHub EnterpriseUsing GitHub EnterpriseChoosing your planGetting started with enterprise software development platforms
About GitHub Enterprise
What is GitHub Enterprise?
GitHub Enterprise is an enterprise-grade software development platform designed for the complex workflows of modern development.
As an extensible platform solution, GitHub Enterprise enables organizations to seamlessly integrate additional tools and functionalities, tailoring their development environment to meet specific needs and enhancing overall productivity.
Why should organizations use GitHub Enterprise
There are several reasons why organizations should consider using GitHub Enterprise:
Accelerate development at scale with AI-powered development: GitHub is the world’s most widely adopted Copilot-powered developer platform helping organizations build, secure, and deliver innovative software at scale.
Application security made simpler: Native security tools embedded into the developer workflow, such as GitHub Advanced Security, help developers easily fix security issues, while providing more visibility and controls.
Centralize governance and compliance: Customers can access a range of administration features to help manage governance at scale and enforce business rules and policies to meet their specific needs.
Boost productivity and collaboration: Increase productivity with automated CI/CD workflows using GitHub Actions, collaborate effectively with GitHub Projects and GitHub Issues, manage hosted packages with GitHub Packages, and utilize prebuilt and configured development environments with GitHub Codespaces.
Greater flexibility and control over data: Whether self-hosting with GitHub Enterprise Server or using GitHub Enterprise Cloud, GitHub provides customers with flexibility and control over their data. And now with GitHub Enterprise Cloud with data residency, customers have enhanced control where certain data, like their code, resides. Start a free 30 day trial today or contact our sales team for more information.
Who uses GitHub Enterprise?
GitHub Enterprise is used by organizations of all sizes that require greater productivity, collaboration, and security capabilities for their software development process. GitHub Enterprise can scale with teams, all the way from a small startup to a large corporation.
What is GitHub Enterprise Cloud?
GitHub Enterprise Cloud is the cloud-based solution of GitHub Enterprise, hosted on GitHub’s servers. This eliminates the need for organizations to maintain their own servers, infrastructure, and updates, allowing them to focus on development.
In addition to the core productivity and collaboration features it provides, GitHub Enterprise Cloud provides access to additional features and add-ons for security, support, managed users, and many more.
Customers can easily add or remove users as needed, and they can also increase storage capacity or processing power as their needs change.
And for customers desiring more control over their data, GitHub Enterprise Cloud with data residency provides improved enterprise-grade features and more control over where code is stored. Start a free 30 day trial today or contact our sales team for more information.
What is GitHub Enterprise Server?
GitHub Enterprise Server is the self-hosted version of GitHub Enterprise. It is installed on-premises or on a private cloud and provides organizations with a secure and customizable source code management and collaboration platform.
One of the key advantages of GitHub Enterprise Server is that it provides organizations with complete control over their source code and data. Organizations can choose where to store their repositories and can control who has access to them. Administrators can also customize the platform to meet specific needs, such as integrating other tools or implementing custom workflows.
GitHub Enterprise Server also offers enhanced security and compliance features. Organizations can configure their instance to meet their specific security requirements, such as using LDAP or SAML for authentication, setting up two-factor authentication, or implementing network security measures. Compliance features are also included, such as audit logs, access controls, and vulnerability scanning.
How secure is GitHub Enterprise?
GitHub Enterprise is designed with security in mind and includes a range of features to help organizations protect their code and data. Here are some of the key security features that GitHub Enterprise offers:
Authentication and access controls: GitHub Enterprise includes two-factor authentication, LDAP and Active Directory integration, and OAuth authentication. This helps organizations ensure that only authorized users can access their repositories and data.
Encryption: All data in transit between the user's computer and GitHub Enterprise server is encrypted using HTTPS. All data at rest uses AES-256 encryption.
Vulnerability scanning: GitHub Enterprise includes built-in security scanning features that can detect known vulnerabilities and alert users.
Audit logs: The platform provides detailed audit logs that record all user actions, including repository access, changes, and deletions. This helps organizations track and monitor user activity and identify potential security issues.
Customizable policies: GitHub Enterprise allows organizations to create custom policies for repository access. This can help enforce compliance requirements and prevent unauthorized access to sensitive data.
Regular security updates: There is also a dedicated security team that provides regular updates, monitors for potential security threats, and responds quickly to any issues that arise.
Is GitHub Enterprise free?
No, GitHub Enterprise is not free. It is a paid product that can be paid for either as a metered service on a monthly basis or as a subscription, with the cost determined by the number of users and the level of support required. For organizations interested in trying out the platform before making a commitment, GitHub Enterprise offers a free trial. Furthermore, organizations can contact the GitHub Sales team for the option to request a custom quote to meet their specific needs.
Using GitHub Enterprise
How can developers collaborate with GitHub Enterprise?
Developers can collaborate with GitHub Enterprise using a variety of tools that are built into the platform, including:
Pull requests: Allows developers to propose changes to a repository and submit them for review. Other team members can review the changes, leave comments, and suggest further improvements.
GitHub Projects: Enables developers to track issues, assign tasks, and prioritize work. This helps teams stay on track, identify and resolve issues quickly, and ensure that everyone is working towards the same goals.
GitHub Discussions: Empowers developers to have conversations about specific topics. This can be particularly useful for triaging complex issues or making decisions about the direction of a project.
Can I migrate a repo from Azure DevOps to GitHub Enterprise without disrupting Azure Boards or Pipelines?
Yes. You can migrate a repo from Azure DevOps to GitHub Enterprise without disruption. Start by migrating a single "pilot" repository to validate the benefits of agentic DevOps. You can run GitHub alongside your existing Azure DevOps projects and migrate at your own pace.
Choosing your plan
How can organizations get started with GitHub Enterprise?
To get started with GitHub Enterprise, try a free trial today or contact our sales team.
What GitHub Enterprise plans are available?
GitHub Enterprise offers several plans that vary in price and features. They are designed to accommodate different types of organizations and teams, from small startups to large enterprises. These plans include:
GitHub Enterprise Server: This is the self-hosted version of GitHub Enterprise. It is installed on-premises or on a private cloud, and offers all the features of the cloud-based version of GitHub, including pull requests, code reviews, and project management tools. Pricing depends on the number of users and support requirements.
GitHub Enterprise Cloud: This is the cloud-based version of GitHub Enterprise. It is hosted on GitHub's servers, and it offers all the features of GitHub Enterprise Server. The price depends on the number of users and storage requirements.
How much does GitHub Enterprise cost?
For more information on cost, please see our pricing page.
Getting started with enterprise software development platforms
What is a DevOps platform?
A DevOps platform is a set of tools, technologies, and practices that enable software development and IT operations teams to collaborate and automate the software delivery process. It typically includes version control, continuous integration and continuous delivery (CI/CD), automated testing, deployment automation, and monitoring.
The main goal of a DevOps platform is to provide a single environment for software development and IT operations teams. By automating the software delivery process, a DevOps platform helps organizations reduce the time and cost of delivering software, while also improving the reliability, security, and scalability of their applications.
What is developer experience?
Developer experience (DevEx) refers to the overall experience that software developers have when using development tools, frameworks, and platforms to create software applications. It encompasses all aspects of a developer's interaction with the tools, including onboarding, maintaining, ease of use, and productivity.
The goal of optimizing DevEx is to make it as easy as possible for developers to create high-quality software quickly. This can involve designing tools with intuitive interfaces, providing clear and concise documentation, seamlessly integrating tools into workflows, and offering comprehensive support to help developers overcome challenges and obstacles.
By prioritizing DevEx, organizations can improve the speed and quality of their software development processes, increase developer satisfaction and retention, and ultimately deliver better products.
What is a software development platform?
A software development platform is a set of tools, technologies, and resources that enable software developers to create, test, deploy, and maintain software applications. This typically includes a programming language or framework, an integrated development environment (IDE), libraries, code repositories, debugging and testing tools, and deployment and hosting options.
The goal of a software development platform is to provide developers with a comprehensive set of tools and resources that make it easier to develop high-quality software. By providing an integrated environment for software development, a software development platform can help developers streamline their workflows, reduce errors, and improve the speed and quality of their work. Additionally, many software development platforms also provide access to a community of developers who can offer support, advice, and resources for improving software development practices.
What is an application development platform?
An application development platform is a set of tools that enables developers to build, deploy, and manage custom software applications.
This kind of platform typically includes a programming language, software development kits (SDKs), application programming interfaces (APIs), libraries, and testing and debugging tools.
These tools are designed to make it easier for developers to create and deploy custom applications for a specific platform, such as a mobile device or web browser.
The goal of an application development platform is to provide developers with a comprehensive set of tools that makes it easier to create high-quality applications that meet the specific requirements of a particular platform or device.
What is software development collaboration?
Software development collaboration is the process of working together as a team to create, test, and deploy software applications. It can involve a range of activities, such as brainstorming, planning, code reviews, testing, and deployment. Collaboration is an essential component of the software development process, as it allows multiple developers and stakeholders to work together.
Effective collaboration requires open communication, clear goals and objectives, shared resources, and a commitment to working together as a team. Collaboration tools such as version control systems, collaborative coding environments, and project management software, can also provide a centralized location for team members to share information, coordinate tasks, and track progress.
Ultimately, software development collaboration is essential to creating high-quality software that’s reliable, scalable, and meets the needs of end-users and stakeholders.
Footnotes
The Total Economic Impact™ Of GitHub Enterprise Cloud, a commissioned study conducted by Forrester Consulting, 2025. Results are for a composite organization based on interviewed customers.
Forrester Wave™: DevOps Platforms, Q2 2025. Forrester does not endorse any company, product, brand, or service included in its research publications and does not advise any person to select the products or services of any company or brand based on the ratings included in such publications. Information is based on the best available resources. Opinions reflect judgment at the time and are subject to change. For more information, read about Forrester’s objectivity here.
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/enterprise
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fenterprise
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## GitHub for teams · Build like the best teams on the planet · GitHub

- Source URL: https://github.com/team
- Crawl depth: 1

GitHub for teams · Build like the best teams on the planet · GitHub
Skip to content
GitHub Universe 2026
Save $600 with Super Early Bird passes through July 8.
Register now
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
GitHub for Teams
Build like the best teams on the planet
With CI/CD, Dependabot, and the world’s largest developer community, GitHub gives your team everything they need to ship better software faster.
Get started with Team
Sign up for free
Compare Plans
Ready to get your
team started?
GitHub Free
Basics for teams
and developers
Unlimited public/private repositories
2,000 Actions minutes/month
500MB of GitHub Packages storage
Dependabot
Community Support
Get started for free
Need SAML, self-hosting, or priority support?
Learn more about GitHub Enterprise
GitHub Team
Advanced collaboration and deployment
features for teams
Everything included in Free, plus ...
3,000 Actions minutes/month
2GB of GitHub Packages storage
GitHub Codespaces
Protected branches
Multiple reviewers in pull requests
Code owners
Draft pull requests
Required reviewers
Pages and Wikis
Web-based support
Featured add-ons
GitHub Secret Protection
Prevent secret leaks before they leak. Remediate those that exist.
Uh oh!
There was an error while loading. Please reload this page.
GitHub Code Security
Fix vulnerabilities in your code before they reach production.
Uh oh!
There was an error while loading. Please reload this page.
Continue with Team
Need something else?
Compare all plans
Collaboration
Manage everything in one place
Connect your favorite tools
Build the way that works best for you with support for all your go-to integrations, including Slack, Jira, and more.
Add your team in a click
Seamlessly update permissions and add new users as you build, whether you’re on a team of two or two thousand.
Speed up code review
Step up your code quality with code review tools that fit right into your workflow.
Plan together
Make it easy for project managers and developers to coordinate, track, and update their work in one place—so projects stay on schedule.
“As a team, we’re way more confident that we’re in tune. We can all see our work, feedback, and roadmap going through GitHub.”
Lee Adkins, Head of Engineering
Peak Money
Automation
Build CI/CD workflows that work for you
Checkout
Check out a Git repository at a particular version.
name: Checkout
uses: actions/checkout@v2.1.0
Set up Node.js environment
Set up a Node.js environment and add it to the PATH, providing additional proxy support.
name: Set up Node.js for use with actions
uses: actions/setup-node@v1.1.0
NPM Publish
Automatically publish packages to NPM.
name: NPM Publish
uses: JS DevTools/npm-publish@v1
Streamline your CI/CD
Build, test, and deploy projects on any OS, language, or cloud.
Choose from thousands of actions
Find community-built GitHub Actions workflows on GitHub Marketplace, or build your own.
Respond to GitHub events
Trigger workflows based on GitHub events, including push, issue creation, new releases, and more.
Collaborate on workflows
Build, share, improve, and reuse actions just like code.
Explore GitHub Actions
“With GitHub Actions, deployments happen 75 percent faster—taking about 10 minutes compared to the 40 minutes required when they were done manually.”
Pierre Laurac, Technical Lead
Front App
Security
Stay focused on development
Grant the right access to your team
Easily grant, limit, or revoke access for collaborators inside and outside your company.
Keep secrets safe
Get alerts when secrets are committed to your repositories—and notify over 30 cloud service providers automatically.
Find vulnerable dependencies
Scan your dependencies automatically. When a vulnerability is found, we’ll open a pull request with suggested fixes.
See how GitHub helps secure your applications
“GitHub’s Dependabot security updates are smarter than any other vulnerability tracking tools we’ve used.”
Alberto Giorgi, Director of Engineering
Tray.io
Users
Home to the world’s software teams
Meet your developers where they already are. GitHub is home to over 40 million developers and the world’s largest open source community.
150M+ million
developers
1B+ billion
contributions
4M+ million
organizations
Customer Stories
You’re in good company
Front App
Customer Story
Read story
Tray.io
Customer Story
Read story
Read more customer stories
Build like the best
Get the complete developer platform
Get started with Team
Sign up for free
Related resources
GitHub Actions cheat sheet
Everything you need to know about getting started with GitHub Actions.
Learn more
Collaboration is the key to DevOps success
In a recent TechTarget study, 70 percent of organizations reported they had adopted DevOps.
Learn more
How healthy teams build better software
Your culture is key to recruiting and retaining the talent you need to ship exceptional customer experiences.
Learn more
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/team
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fteam
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## Build your startup on GitHub · GitHub

- Source URL: https://github.com/enterprise/startups
- Crawl depth: 1

Build your startup on GitHub · GitHub
Skip to content
GitHub Universe 2026
Save $600 with Super Early Bird passes through July 8.
Register now
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
GitHub for Startups
Founders build the future on GitHub
You bring the ambition. We’ll bring GitHub’s full agentic platform, product credits, and community support — giving partner-affiliated startups exclusive access to the tools and network they need to deliver the next big thing.
See our partnersStart a free trial
Start on GitHub. Scale with Copilot. Secure throughout.
Access to GitHub’s full agentic developer platform — from Copilot and agentic workflows to built-in, workflow-native security.
$10,000 in flexible platform credits to build, ship, and scale with GitHub Enterprise, Copilot, Advanced Security, Actions, and more.
/enterprise/startups logos
Build at scale with Enterprise
Run production-grade CI/CD with 50k included Action minutes and manage artifacts with GitHub Packages - the same infrastructure used by the world’s leading engineering teams.
Ship faster with Copilot
Extend your team with GitHub Copilot’s coding agent and code review - so you can unblock pull requests, fix bugs, and ship faster without adding headcount.
Secure with Advanced Security
Protect your software, dependencies, and pipelines with GitHub Code Security, GitHub Secret Protection, and Dependabot, while maintaining developer velocity.
Everything you need from day one
GitHub for Startups supports you every step of the way.
$10k in credits
Explore GitHub’s full agentic developer platform without upfront tooling costs.
Don't wait to get started
Apply through a GitHub for Startups partner and be up and running in minutes.
Get guidance to scale
Get the most out of your credits with tailored onboarding, office hours, and technical best practices.
40k Startups in our global community
300k Developers
1,000+ Venture and ecosystem partners
160 Countries represented
GitHub for Startups partners with leading VCs, accelerators, and startup support organizations to help early-stage startups go from seed funding to unicorn status.
Apply to become a GitHub for Startups Partner
Get started today
GitHub for Startups partners with leading investors, accelerators, and startup support organizations to help early-stage startups go from seed funding to unicorn status.
See our partnersContact sales
GitHub events
Connect with fellow founders, developers, and builders through GitHub-hosted events, livestreams, and meetups.
Explore events
Attract funding
Explore funding avenues from open source funding and venture capital from GitHub Fund and M12.
Check out GitHub Fund
Learning Pathways
Dive into tutorials, hands-on projects, and expert-led lessons built for builders. Browse our full content library to level up your GitHub skills and start shipping faster—at your own pace.
Browse learning resources
Frequently asked questions
What’s included in the GitHub for Startups offer?
Eligible startups receive $10,000 in GitHub credits to use across the full GitHub Enterprise platform for up to 12 months.
Credits are applied to the startup’s Enterprise account and are used toward their GitHub Enterprise license costs and eligible add-ons, including GitHub Copilot (licenses, premium models, and agentic capabilities), GitHub Advanced Security, and other metered offerings—giving teams the flexibility to adopt the tools they need as they grow.
Who is eligible to apply to GitHub for Startups?
Eligible startups must be affiliated with a GitHub for Startups partner, have received outside funding (up to Series B or earlier), and be new to GitHub Enterprise - meaning they have not been on a GitHub Enterprise plan within the past six months. Startups must also not have previously received GitHub credits or GitHub Enterprise licenses.
Am I eligible for credits if I'm new to GitHub Enterprise?
If you are new to GitHub Enterprise and have not previously received credits or licenses, you are eligible for GitHub for Startups benefits.
What does it mean to be "new or returning" to GitHub Enterprise?
This refers to startups that are either using GitHub Enterprise for the first time, or that previously used GitHub Enterprise but have not been on an Enterprise plan within the past six months, and have not previously received credits.
What if my startup is not eligible for GitHub for Startups? Are there other resources for me?
If you’re not currently eligible for GitHub for Startups but would like to try GitHub’s premium features (Enterprise, Advanced Security, Copilot), you can sign up for a trial here.
Can I refer my startup to GitHub for Startups through an approved partner?
Yes, any investor, incubator, or accelerator is eligible. Share this link to refer your partner.
How can I get help if I have issues or questions?
If you have any questions or need assistance, please contact the startup team at startups@github.com.
How long does it take to get approved?
If your application is approved, the GitHub for Startups benefits will be applied directly to your account, and the account admin will receive an onboarding email within 24 hours. If ineligible, we’ll notify you of the reason.
How can I apply to become a venture partner of GitHub for Startups?
You can apply to be an investor partner by applying on our application page. We partner with leading VCs, incubators, and accelerators dedicated to helping early-stage startups succeed.
What are the key terms and conditions of the GitHub for Startups offer?
Credits Application: Credits will be applied only to the Enterprise account submitted in this application and cannot be transferred to another account.
One-Time Redemption: Startups may redeem the GitHub for Startups offer only once. If you have previously received GitHub Enterprise credits through Microsoft or GitHub for Startups you are not eligible to receive additional credits. Accounts found to be in violation of these terms may have credits revoked at GitHub’s discretion.
Payment Method: Please expect an authorization charge on your payment method within a few weeks of onboarding. Failure to have a valid payment method on file or a failed authorization will result in your account being locked.
Program Duration: Credits are valid for up to 12 months from approval. Credits expire upon full consumption or at the end of the 12-month period, whichever occurs first.
Automatic Billing Transition: Upon credit exhaustion or program expiration, any active products will automatically transition to standard paid billing and will be charged to the payment method on file.
Primary Contact Responsibility: All important program and billing communications are sent to the primary email address of the Enterprise account owner(s). Participants are responsible for monitoring this inbox.
Downgrades: Participants may downgrade from GitHub Enterprise at any time. However, if the account is downgraded before credits are fully consumed or the program period ends, the startup forfeits any remaining credits and will not be eligible to reapply.
Deprecation of Prior Offer: Please note that our previous startup offer has been discontinued and is no longer available.
Data Residency: At this time, we do not support Enterprises with data residency, and can only accept standard accounts with Enterprise Cloud on GitHub.com.
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/enterprise/startups
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fenterprise%2Fstartups
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## GitHub for Nonprofits · GitHub

- Source URL: https://github.com/solutions/industry/nonprofits
- Crawl depth: 1

GitHub for Nonprofits · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Solutions
By industry
GitHub for Nonprofits
Drive social impact one commit at a time
GitHub for Nonprofits enables organizations to leverage technology to drive forward their missions and accelerate human progress. Verified nonprofits get exclusive access to a free GitHub Team plan or 25% off the GitHub Enterprise cloud plan.
Join GitHub for Nonprofits
Exclusive discounts for verified nonprofits
Free access to a GitHub Team plan
Receive access to advanced collaboration tools for individuals and organizations.
25% off GitHub Enterprise Cloud
Get access to additional security, administrative, and customization options.
Unlock the Nonprofit Developer Pack
Advanced technology shouldn't be gated behind high-margin corporate budgets. We’ve partnered with leading tech companies for exclusive discounts to help you solve the world's most pressing challenges.
Let GitHub power your mission
Investing in GitHub is not just about adopting a tool—it's about empowering nonprofits to drive positive change and advance the Sustainable Development Goals. Join us at GitHub, where technology meets purpose, and together, let's create a more sustainable and equitable future for all.
Increase visibility and widen impact
By hosting projects on GitHub, nonprofits can increase their visibility and reach a broader audience. Whether it's sharing code libraries, publishing research, or showcasing success stories, GitHub provides nonprofits with a platform to amplify their impact and attract support from donors, funders, volunteers, and partners.
Tap into the open source community
GitHub is home to the largest open source community on the planet - over 100 million developers. Whether you’re scaling your organization or just learning how to code, GitHub is your home. Join the world’s largest developer platform to build the innovations that empower humanity.
“
GitHub provides us with a platform to amplify the critical needs of forcibly displaced persons and attract support from donors, volunteers, and partners, while also tapping into skills and resources of an incredible developer community.
Seema IyerUSA for UNCHR
Get started today
Build your nonprofit on the world's most advanced developer platform. Verified nonprofits get exclusive access to a free GitHub Team plan or 25% off the GitHub Enterprise cloud plan.
Join GitHub for NonprofitsContact us
Frequently Asked Questions
Who qualifies for GitHub for Nonprofits?
Nonprofit organizations that are 501(c)(3) or equivalent and are non-governmental, non-academic, non-commercial, and non-political in nature are eligible for a free GitHub Team Plan with unlimited private repositories and unlimited users or 25% off of GitHub Enterprise Cloud.
What if our organization does not qualify for nonprofit status but works in the social sector?
At this time, we only support registered 501(c)(3) or equivalent organizations. In the future, we hope to provide additional programmatic support to social sector organizations.
What are the different GitHub pricing plans?
GitHub offers free and paid plans for storing and collaborating on code. Some plans are available only to personal accounts, while other plans are available only to organization and enterprise accounts. For more information about accounts, see "Types of GitHub accounts."
I'd like more information on how GitHub for Nonprofits works, where can I go?
Check out the GitHub for Nonprofits documentation to learn more about the platform and services.
I have another question, how do I reach the team?
If you would like to learn more about our programming, partner with us, or get in touch, contact our team today.
What is the Nonprofit Developer Pack?
The Nonprofit Developer Pack is a curated collection of free and discounted services from GitHub and our partners. It provides nonprofits with access to premium developer tools, cloud credits, and security suites to help them scale their missions without being limited by their tech budgets.
How is this different from the existing GitHub for Nonprofits program?
The Developer Pack expands these benefits by including external tools and services from partner companies.
How do I apply for the Pack?
The process is handled through the GitHub for Nonprofits portal:
Authentication: Sign in to your GitHub organization account.
Automatic Check: Our system first checks if your organization is already in our validated database.
Manual Application: If you aren't automatically validated, you can submit a form with your country of registration, registration ID, and proof of status (e.g., your 501(c)(3) letter).
How can my company become a partner?
We are actively onboarding partners who want to support the social sector. Partners benefit from early exposure to thousands of nonprofits and the opportunity to help shape the program’s future. If you’re interested, contact our team today.
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/solutions/industry/nonprofits
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fsolutions%2Findustry%2Fnonprofits
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## App Modernization Solutions | GitHub · GitHub

- Source URL: https://github.com/solutions/use-case/app-modernization
- Crawl depth: 1

App Modernization Solutions | GitHub · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Solutions
By use case
GitHub App Modernization
Modernize your applications in days, not months
Assess, upgrade, and migrate apps to the cloud at scale with GitHub Copilot.
Get startedContact sales
Pause
Accelerate app modernization and eliminate tech debt with GitHub Copilot
Modernize at scale
Assess applications at scale, plan application specific journeys, and execute with automated upgrades with the modernization agent
Customize and repeat tasks
Encode your own business logic, define software factory patterns, and standardize outcomes with custom skills
Streamline end-to-end migration
Simplify the migration journey from assessment to deployment with full visibility, control, and predictability, while delivering higher quality outcomes
Agents do the heavy lifting
Copilot analyzes codebases, builds migration plans unique to each application, surfaces blockers, and suggests fixes—automating repetitive steps so developers can focus on higher value work and scale.
A smoother upgrade path
Automate upgrades for .NET and Java runtimes and frameworks with guided remediation that updates configs, libraries, and dependencies.
Stay in control
Recommendations are reviewable and every change is validated through your tests and pipelines. Built-in security checks catch CVEs (Common Vulnerabilities and Exposures) early, ensuring alignment with your standards and policies.
Migrate to Azure with confidence
Migrate and deploy easily on Azure services—Azure App Service, Azure Container Apps, and Azure Kubernetes Service— with compatibility guidance and security hardening.
Read the technical blog
Proven impact
70% less time spent on migration efforts
50% less effort to upgrade apps
500k+ lines of code changed within weeks
Ready to modernize?
Transform your Java and .NET apps with GitHub Copilot and reduce risk, accelerate transformation, and unlock the full potential of the cloud.
Get startedContact sales
Additional Resources
Power up your Java application modernization
Simplify Java application migration and modernization with AI-driven remediation and automated fixes designed to save time and reduce errors.
Download your Java extension
Modernize .NET applications with ease
Unlock new capabilities in .NET by streamlining app upgrades and preparing your codebase for the cloud.
Learn more about .NET
Explore the full documentation
Dive deeper with step-by-step guides, best practices, and technical resources to support every stage of your migration.
Read the docs
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/solutions/use-case/app-modernization
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fsolutions%2Fuse-case%2Fapp-modernization
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## Unified DevSecOps Solutions Built for Security | GitHub · GitHub

- Source URL: https://github.com/solutions/use-case/devsecops
- Crawl depth: 1

Unified DevSecOps Solutions Built for Security | GitHub · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Solutions
By use case
GitHub DevSecOps
The AI-powered DevSecOps platform
With comprehensive security tools built into the developer workflow, you can build, secure, and ship all in one place.
Request a demoSee plans & pricing
Integrate AI-powered security features directly
into your development workflow, eliminating
the need for third-party tools.
Code scanning
Find and fix security issues before production with static application security testing (SAST).
Secret scanning
Hunt, revoke, and prevent leaked secrets with automatic push protection.
Supply chain security
Keep vulnerable dependencies out of your applications with software composition analysis (SCA).
Logos for EY Mercado Libre 3M KPMG TELUS
Give AI the heavy lifting
Organizations struggle to fix their backlog of vulnerabilities, despite the risks. Coming next, security managers can burn down years of security debt in one simple sprint.
Discover GitHub Copilot
Found means fixed
Don’t just find vulnerable code, fix it. GitHub Advanced Security flags problems and suggests AI-powered solutions, freeing teams to ship more secure software faster.
Explore AI-powered security
Pump your team’s security prowess
Developers aren’t security professionals. With GitHub Advanced Security, you can offload the technical complexity and give them the freedom to build and ship great software.
Discover code scanning autofix
Your workflows, your way
With support for more than 17,000 app integrations, GitHub Advanced Security accommodates your team’s tooling preferences.
Explore GitHub Marketplace
7x faster vulnerabilities fixes
2.4 fewer false positives than the industry standard
20M repositories that have enabled secret scanning
“
We prefer to have security that leverages what developers are already using rather than trying to force them to use some other tool.
Jim JacobsChief Analyst, Gartner
Application security made simpler
Eliminate toolchain cost and complexity with native security tools for GitHub Enterprise and Azure DevOps customers.
Request a demoSee plans & pricing
Additional Resources
DevSecOps explained
Explore how DevSecOps builds on the ideas of DevOps by applying security practices throughout the SDLC.
Learn more
Meet the companies who build with unified DevSecOps
Leading organizations choose GitHub to plan, build, secure, and ship software.
Read customer stories
Discover how AI is changing the security landscape
From prevention to remediation, see how AI can help fix issues instantly.
Watch webinar
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/solutions/use-case/devsecops
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fsolutions%2Fuse-case%2Fdevsecops
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## Unified AI-Powered Platforms for DevOps Solutions | GitHub · GitHub

- Source URL: https://github.com/solutions/use-case/devops
- Crawl depth: 1

Unified AI-Powered Platforms for DevOps Solutions | GitHub · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Solutions
By use case
GitHub DevOps
The unified platform for your DevOps lifecycle
Build, scale, and deliver more secure software with GitHub's unified AI-powered developer platform.
Start a free trialContact sales
Keep developers in the flow with automation, AI, collaboration tools, and more.
Increase collaboration
Get the tools you need to facilitate collaboration among teams.
Eliminate barriers
Harness the power of AI-powered coding to empower developer creativity and innovation.
Reduce context switching
Boost productivity with a single, integrated developer platform with powerful native tools to keep developers in the flow.
Logos for Ford, Shopify, NASA, Vercel, and Spotify
Drive innovation with AI-powered developer tools
AI-driven code suggestions enhances job satisfaction and focus for 60-75% of developers, reducing frustration and enabling more rewarding work.
Explore GitHub Copilot
Built-in security
Manage the SDLC with automated security tools. Find and fix vulnerabilities quickly and efficiently with security checks integrated into every step of the developer's workflow.
Explore GitHub Advanced Security
Streamline team collaboration
Help developers and operations teams more regularly communicate and provide feedback about timelines and goals so everyone is responsible for the project’s success.
Explore collaboration tools
88% of developers experience increased productivity
75% reduced time spent managing tools
1min set-up time for largest repo with GitHub Codespaces
Unlock 376% ROI with GitHub Enterprise Cloud
Read the report
“
The availability of out-of-the-box integrations with our existing tooling is a big part of GitHub’s appeal. GitHub really helps bring DevOps to life.
Danilo SuntalManufacturing Data Flow Product and Platform, P&G
DevOps strategies, amplified by GitHub tools
Trusted by 90% of the Fortune 100, GitHub helps millions of developers and companies collaborate, build, and deliver secure software faster. And with thousands of DevOps integrations, developers can build smarter from day one with the tools you know and love—or discover new ones.
Start a free trialContact sales
Additional Resources
Find the right DevOps platform
Narrow your search with the 2024 Gartner® Magic Quadrant™ for DevOps Platforms report.
Get the Gartner report
What is DevOps?
By bringing people, processes, and products together, DevOps enables development teams to continuously deliver value.
Learn more about DevOps
Discover innersource
This practice empowers developers to save time and energy by bringing methodologies from open source into their internal development.
Read more on Innersouce
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/solutions/use-case/devops
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fsolutions%2Fuse-case%2Fdevops
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## A Complete CI/CD Solution for Software Development | GitHub · GitHub

- Source URL: https://github.com/solutions/use-case/ci-cd
- Crawl depth: 1

A Complete CI/CD Solution for Software Development | GitHub · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Solutions
By use case
GitHub CI/CD
The complete CI/CD solution
Build, test, and deploy software with simple and secure enterprise CI/CD, all on the complete development platform.
Start a free trialContact sales
Streamline, secure, and deploy with confidence: automate your software delivery pipeline
Turn code into software
Automatically trigger builds on every commit with workflow builder.
Secure and improve
End-to-end testing for security, code quality, performance, and functionality.
Ship with confidence
Automate deployments from start to finish to one or multiple cloud providers.
Build fast, stay secure
Easy-to-set-up and simple-to-maintain CI/CD that helps your developers build more secure code from the start without sacrificing speed.
Explore GitHub Advanced Security
Continuous testing made simple
Track everything from code quality to your security profile with end-to-end testing built to keep you secure and in compliance at every stage.
Deploy software with confidence
Seamless CI/CD deployment automation makes it simple to deliver secure software with all cloud providers so you can scale confidently.
Explore GitHub Actions
90%+ Fortune 100 choose GitHub
100M+ Developers call GitHub home
420M+ Repositories on GitHub
Powerful CI/CD with GitHub Enterprise
The complete developer platform to build, scale, and deliver secure software.
Start a free trialContact sales
Additional Resources
DevOps tips for Engineering leaders
6 DevOps tips to help engineering leaders deliver software at scale
Get the report
Ship secure software fast
How developer-first supply chain security helps you secure faster
Get the report
CI/CD Solution Demo
How to automate CI/CD and security with GitHub Enterprise
Get the report
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/solutions/use-case/ci-cd
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fsolutions%2Fuse-case%2Fci-cd
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## GitHub Use Case Solutions | GitHub · GitHub

- Source URL: https://github.com/solutions/use-case
- Crawl depth: 1

GitHub Use Case Solutions | GitHub · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Solutions
Use Cases
GitHub solutions
Solve your business challenges with proven combinations of GitHub solutions, empowering your team to ship secure software quickly and accelerate innovation.
Start a free trialContact sales
Build faster with GitHub Copilot
Accelerate one of the biggest bottlenecks in the SDLC: code review.
Learn more
Clear the backlog that’s slowing everything down
Learn how GitHub Copilot helps teams eliminate backlog drag by automating routine development work.
Learn more
Ship with confidence. Maintain without fear.
Learn how GitHub Copilot helps teams improve code quality and maintainability by embedding automated agents for code review, refactoring, and test generation into development workflows.
Learn more
App Modernization
Assess, upgrade, and migrate apps to the cloud with GitHub Copilot.
Learn more
DevSecOps
With comprehensive security tools built into the developer workflow, you can build, secure, and ship all in one place.
Learn more
DevOps
Scale and deliver more secure software with GitHub's unified AI-powered developer platform.
Learn more
CI/CD
Test and deploy software with simple and secure enterprise CI/CD.
Learn more
Related solutions
Healthcare
By incorporating security checks into developer workflows, you can build secure communication channels between patients and providers.
Learn more
Financial Services
With an AI-powered developer platform, you can build innovative financial solutions that drive economic growth.
Learn more
Manufacturing
With robust CI/CD that can handle the complex needs of manufacturing, you can securely transform operations at scale.
Learn more
2.4x more precise leaked secrets found with fewer false positives
~25% increase in developer speed with GitHub Copilot
1min set-up time for largest repo with GitHub Codespaces
+88% more productivity with GitHub Enterprise
Get started
Trusted by 90% of the Fortune 100, GitHub helps millions of developers and companies collaborate, build, and deliver secure software faster. And with thousands of DevOps integrations, developers can build smarter from day one with the tools they know and love—or discover new ones.
Start a free trialContact sales
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/solutions/use-case
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fsolutions%2Fuse-case
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## AI-Powered Platform for Secure Healthcare Solutions | GitHub · GitHub

- Source URL: https://github.com/solutions/industry/healthcare
- Crawl depth: 1

AI-Powered Platform for Secure Healthcare Solutions | GitHub · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Solutions
By industry
Healthcare solutions
Empower healthcare development with a secure, AI-powered platform
By incorporating AI into developer workflows, you can build secure patient care solutions at scale.
Start a free trialContact sales
A single, integrated,
enterprise-ready platform
Enhance patient care
Facilitate rapid innovation so you can implement the latest technologies more reliably.
Unlock engineering potential
Empower developer collaboration, productivity, and creativity at scale.
Streamline healthcare development
Focus on delivering impactful patient outcomes by priming your engineering staff for growth.
logos for 3M, Amplifon, Doctolib, Philips and Procter and Gamble
Drive healthcare innovation with AI
By enabling your developers to code up to 55% faster, you can stay ahead of advancements and innovate services while remaining secure and compliant.
Explore GitHub Copilot
Protect patient data
Create more secure healthcare applications by detecting vulnerabilities in your codebase and preventing credentials from being exposed.
Explore GitHub Advanced Security
Automate manual tasks
Make life easier for developers. Reduce time-to-market and improve responsiveness to patients and stakeholders by using enterprise-ready, scalable CI/CD.
Explore GitHub Actions
+88% more productivity with GitHub Enterprise
1min set-up time for largest repo with GitHub Codespaces
~25% increase in developer speed with GitHub Copilot
Read how Doctolib fostered a culture of reusability and simplified the CI/CD process with GitHub.
Read the customer story
“
Healthcare organizations want a service that provides a world-class experience for patients and improves people’s lives. GitHub helps us meet and exceed those expectations.
David TerolProgram director at the Philips Software Center of Excellence
3M transforms its software toolchain to bring cutting-edge science to customers, faster.
Read story
Philips builds and deploys digital health technology faster with innersource on GitHub.
Read story
GitHub brings DevOps to life and enables streamlined developer experiences at Procter & Gamble.
Read story
DevOps strategies for healthcare innovation, amplified by GitHub
Trusted by 90% of the Fortune 100, GitHub helps millions of developers and companies collaborate, build, and deliver secure software faster. And with thousands of DevOps integrations, developers can build smarter from day one with the tools they know and love—or discover new ones.
Start a free trialContact sales
Additional Resources
Find the right DevOps platform
Narrow your search with the 2024 Gartner® Magic Quadrant™ for DevOps Platforms report.
Get the Gartner report
What is DevOps?
By bringing people, processes, and products together, DevOps enables development teams to continuously deliver value.
Learn more about DevOps
Discover innersource
This practice empowers developers to save time and energy by bringing methodologies from open source into their internal development.
Read more on Innersouce
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/solutions/industry/healthcare
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fsolutions%2Findustry%2Fhealthcare
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## AI-Powered Financial Solutions for Secure Innovation | GitHub · GitHub

- Source URL: https://github.com/solutions/industry/financial-services
- Crawl depth: 1

AI-Powered Financial Solutions for Secure Innovation | GitHub · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Solutions
By industry
Financial services
Transform financial services with a secure, AI-powered solution
By embedding AI into developer workflows, you can accelerate secure financial innovation at scale.
Start a free trialContact sales
Build secure financial services by having an
all-in-one platform that eliminates the need
for third-party tools and keeps developers
in the flow.
Reduce risk
Avoid data breaches and fraud by incorporating security practices throughout the development process.
Increase speed and efficiency
Enable faster development and deployment of new features and services by leaving the manual, repetitive tasks to AI.
Streamline operations
Improve efficiency and enhance developer creativity by working on a single, secure, AI-powered platform.
Logos for Itaú Mercari Mercado Libre Stripe and Plaid
Get ahead with AI-powered innovation
Stay at the forefront of technological advancements by using AI-powered tools to innovate services while remaining secure and compliant.
Explore GitHub Copilot
Enhance regulatory compliance and security
Meet regulatory standards and secure your supply chain by leveraging  AI-powered compliance features and natively-embedded application security testing.
Explore GitHub Advanced Security
Accelerate software development
Automation is everything. Reduce time-to-market and improve responsiveness to customers by using enterprise-ready, scalable CI/CD.
Explore GitHub Actions
Read how Societe Generale tripled their releases and cut development time by more than half.
Read the customer story
“
We used to have other tools as well, but GitHub offers us with an all-in-one solution that provides developers a single source of truth for security notifications and code management.
David HeitzingerHead of Agile Engineering Support // Raiffeisen Bank
DevOps strategies for financial innovation, amplified by GitHub
Trusted by 90% of the Fortune 100, GitHub helps millions of developers and companies collaborate, build, and deliver secure software faster. And with thousands of DevOps integrations, developers can build smarter from day one with the tools they know and love—or discover new ones.
Start a free trialContact sales
Additional Resources
Find the right DevOps platform
Narrow your search with the 2024 Gartner® Magic Quadrant™ for DevOps Platforms report.
Get the Gartner report
What is DevOps?
By bringing people, processes, and products together, DevOps enables development teams to continuously deliver value.
Learn more about DevOps
Discover innersource
This practice empowers developers to save time and energy by bringing methodologies from open source into their internal development.
Read more on Innersouce
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/solutions/industry/financial-services
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fsolutions%2Findustry%2Ffinancial-services
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## AI-Powered Manufacturing Solutions | GitHub · GitHub

- Source URL: https://github.com/solutions/industry/manufacturing
- Crawl depth: 1

AI-Powered Manufacturing Solutions | GitHub · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Solutions
By industry
Manufacturing solutions
Advance manufacturing with a complete, AI-powered platform
By integrating AI into developer workflows, you can securely transform manufacturing operations at scale.
Start a free trialContact sales
Support manufacturing's complex needs
with an all-in-one platform that eliminates
third-party tools, keeping developers in flow.
Enhance industrial efficiency
Ensure the reliable implementation of cutting-edge technologies by incorporating security practices throughout the development process.
Move fast, safely
Build at the speed of innovation and enable faster deployment by embedding AI into developer workflows.
Reduce context switching
Boost efficiency and increase creativity by enabling developers to plan, track, and build in a single, integrated, AI-powered platform.
Logos for 3M P&G Decathlon Ford and Bolt
Drive industrial innovation
Boost developer productivity and innovation with AI-powered tools, while remaining secure and compliant.
Explore GitHub Copilot
Secure your supply chain
Minimize the risk of disruptions and data breaches by using robust security features and best practices, embedded directly into the developer workflow.
Explore GitHub Advanced Security
Support developers with automation
Transform continuous integration processes by using enterprise-ready, scalable CI/CD—now with Arm-hosted runners.
Explore Arm64 on GitHub Actions
Read how Procter & Gamble streamlined the developer experience and improved developer satisfaction and security.
Read the customer story
“
You don’t have to go out to a separate project management tool. You don’t have to go to a spreadsheet, or a Microsoft project, or into Jira. It’s all on GitHub. It’s made us more productive.
Tina Beamer3M IT manager of operations and quality
DevOps strategies for manufacturing innovation, amplified by GitHub
Trusted by 90% of the Fortune 100, GitHub helps millions of developers and companies collaborate, build, and deliver secure software faster. And with thousands of DevOps integrations, developers can build smarter from day one with the tools they know and love—or discover new ones.
Start a free trialContact sales
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/solutions/industry/manufacturing
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fsolutions%2Findustry%2Fmanufacturing
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## Government Agency Software Development Solutions | GitHub · GitHub

- Source URL: https://github.com/solutions/industry/government
- Crawl depth: 1

Government Agency Software Development Solutions | GitHub · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Solutions
By industry
Government solutions
Empowering government agencies with secure, collaborative software development
With seamless collaboration and robust compliance, GitHub helps government agencies build and innovate securely on a single, AI-powered platform.
Start a free trialContact sales
Transforming government software development
with security, collaboration, and flexibility
Secure and compliant development
With FedRAMP authorization and industry-leading security features, GitHub meets the highest standards of compliance and protection.
Efficient collaboration across teams
GitHub’s collaborative platform enables seamless code sharing, review, and feedback within your agency or with external partners.
Flexible deployment options
No matter where you need to host, GitHub Enterprise offers flexible deployment options to meet your agency’s unique operational requirements.
Protect sensitive data
Help keep your agency’s code secure with built-in vulnerability scanning, secret detection, and compliance monitoring, all seamlessly integrated into your development workflow..
Explore GitHub Advanced Security
Accelerate development with AI-powered assistance
Whether drafting complex algorithms or automating tasks, GitHub Copilot empowers your agency to deliver mission-critical software with speed and precision.
Explore GitHub Copilot
Automated, secure CI/CD
With customizable workflows and integrations, your agency can streamline operations and ensure consistent, high-quality code delivery.
Explore GitHub Actions
Learn how the VA modernizes its approach to make healthcare more accessible to millions of veterans.
Read the customer story
“
We reduced our deployment time significantly. To deliver quickly, using GitHub and Azure DevOps for our DevSecOps process, CI/CD, infrastructure, code, and automation was the key.
Shamal SiwanLead DevOps Engineer/Solutions Architect // California Department of Technology
DevOps strategies for government agencies, amplified by GitHub
Trusted by 90% of the Fortune 100, GitHub helps millions of developers and companies collaborate, build, and deliver secure software faster. And with thousands of DevOps integrations, developers can build smarter with the tools they know from day one—or discover new ones.
Contact salesStart a free enterprise trial
Additional Resources
Find the right DevOps platform
Narrow your search with the 2024 Gartner® Magic Quadrant™ for DevOps Platforms report.
Get the Gartner report
What is DevOps?
By bringing people, processes, and products together, DevOps enables development teams to continuously deliver value.
Learn more about DevOps
Discover innersource
This practice empowers developers to save time and energy by bringing methodologies from open source into their internal development.
Read more on Innersouce
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/solutions/industry/government
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fsolutions%2Findustry%2Fgovernment
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## GitHub Industry Solutions | GitHub · GitHub

- Source URL: https://github.com/solutions/industry
- Crawl depth: 1

GitHub Industry Solutions | GitHub · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Solutions
Industries
Industry solutions
Discover how GitHub’s industry solutions can help you improve efficiency, reduce costs, and capture new market opportunities.
Start a free trialContact sales
Healthcare
By incorporating security checks into developer workflows, you can build secure communication channels between patients and providers.
Learn more
Financial Services
With an AI-powered developer platform, you can build innovative financial solutions that drive economic growth.
Learn more
Manufacturing
With robust CI/CD that can handle the complex needs of manufacturing, you can securely transform operations at scale.
Learn more
Government
With seamless collaboration and robust compliance, GitHub helps government agencies build and innovate securely on a single, AI-powered platform.
Learn more
Related solutions
DevSecOps
With comprehensive security tools built into the developer workflow, you can build, secure, and ship all in one place.
Learn more
DevOps
Scale and deliver more secure software with GitHub's unified AI-powered developer platform.
Learn more
CI/CD
Test and deploy software with simple and secure enterprise CI/CD.
Learn more
Executive Insights
Get expert perspectives. Stay ahead with insights from industry leaders.
Learn more
Narrow your DevOps platform search with this Gartner report
Read the report
2.4x more precise leaked secrets found with fewer false positives
~25% increase in developer speed with GitHub Copilot
1min set-up time for largest repo with GitHub Codespaces
+88% more productivity with GitHub Enterprise
Get started
Trusted by 90% of the Fortune 100, GitHub helps millions of developers and companies collaborate, build, and deliver secure software faster. And with thousands of DevOps integrations, developers can build smarter from day one with the tools they know and love—or discover new ones.
Start a free trialContact sales
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/solutions/industry
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fsolutions%2Findustry
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## GitHub · Scalable AI-Powered Enterprise Platform Solutions · GitHub

- Source URL: https://github.com/solutions
- Crawl depth: 1

GitHub · Scalable AI-Powered Enterprise Platform Solutions · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
AI-powered platform solutions to solve your company’s challenges
GitHub empowers your team to deliver software faster and more efficiently, while maintaining robust security and compliance.
Start a free trialContact sales
GitHub scales with
teams of any size
Enterprises
Build, scale, and deliver secure software faster with GitHub’s AI-powered developer platform.
Learn more
Teams
With CI/CD, Dependabot, and the world's largest developer community, GitHub provides everything your team needs to ship secure software faster.
Learn more
Startups
Go from idea to IPO in one place, complete with personalized onboarding, office hours, and tailored product guidance.
Learn more
The enterprise-grade platform that developers know and love.
Learn more about GitHub Enterprise
Solving industry-specific
challenges
View all industries
Healthcare
By incorporating security checks into developer workflows, you can build secure communication channels between patients and providers.
Learn more
Financial Services
With an AI-powered developer platform, you can build innovative financial solutions that drive economic growth.
Learn more
Manufacturing
With robust CI/CD that can handle the complex needs of manufacturing, you can securely transform operations at scale.
Learn more
The solutions you need
to build what you want
View all use cases
Build faster with GitHub Copilot
Accelerate one of the biggest bottlenecks in the SDLC: code review.
Learn more
Clear the backlog that’s slowing everything down
Learn how GitHub Copilot helps teams eliminate backlog drag by automating routine development work.
Learn more
Ship with confidence. Maintain without fear.
Learn how GitHub Copilot helps teams improve code quality and maintainability by embedding automated agents for code review, refactoring, and test generation into development workflows.
Learn more
Adopted by the world's leading organizations
View all customer stories
3M transforms its software toolchain to bring cutting-edge science to customers, faster.
Read story
Philips builds and deploys digital health technology faster with innersource on GitHub.
Read story
GitHub brings DevOps to life and enables streamlined developer experiences at Procter & Gamble.
Read story
Get started
Trusted by 90% of the Fortune 100, GitHub helps millions of developers and companies collaborate, build, and deliver secure software faster. And with thousands of DevOps integrations, developers can build smarter from day one with the tools they know and love—or discover new ones.
Start a free trialContact sales
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/solutions
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fsolutions
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## GitHub Articles • Technical Guides, Developer Insights & Best Practices · GitHub

- Source URL: https://github.com/resources/articles?topic=ai
- Crawl depth: 1

GitHub Articles • Technical Guides, Developer Insights & Best Practices · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
GitHub Articles
Filters (1)
Open Filters
Topic
Topic
AI
Software Development
Security
DevOps
Clear allApply
What Is Vibe Coding?
Turn ideas into code faster with plain language prompts and agentic AI support.
Learn more
AI coding tools for beginner and expert coders
How beginner and expert coders use AI coding tools to code faster and ship great software.
Learn more
What is Agentic AI?
Discover how agentic AI helps software development teams increase productivity and focus on more strategic tasks.
Learn more
What are Generative AI Models?
Learn how generative AI models help businesses succeed.
Learn more
What are AI agents?
AI agents transform software development by automating workflows and enhancing security. Explore the different types of AI agents and get a glimpse into the future of AI in development and security.
Learn more
What is prompt engineering?
Prompt engineering is the practice of crafting effective instructions that guide AI models to produce accurate, useful results.
Learn more
What is Unsupervised Learning?
Unsupervised learning finds patterns in unlabeled data, making sense of complex datasets.
Learn more
What is generative AI (GenAI)?
Generative AI creates new content—text, code, images, audio, and video—from existing data.
Learn more
What is open source AI?
Open source AI offers more control, clarity, and room to build the way you want.
Learn more
What is retrieval-augmented generation (RAG)?
AI often struggles with knowledge gaps and factual errors. Learn how retrieval-augmented generation (RAG) helps solve this.
Learn more
What is AIOps?
AI for IT operations (AIOps) uses AI to help IT teams reduce downtime and scale operations.
Learn more
What are neural networks?
Discover what neural networks are and why they’re critical to developing intelligent systems.
Learn more
Previous12Next
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/resources/articles?topic=ai
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fresources%2Farticles%3Ftopic%3Dai
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## GitHub Articles • Technical Guides, Developer Insights & Best Practices · GitHub

- Source URL: https://github.com/resources/articles?topic=software-development
- Crawl depth: 1

GitHub Articles • Technical Guides, Developer Insights & Best Practices · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
GitHub Articles
Filters (1)
Open Filters
Topic
Topic
AI
Software Development
Security
DevOps
Clear allApply
What is an API?
APIs act as bridges between different pieces of software, enabling them to communicate, share data, and work together.
Learn more
What is software development?
Explore the world of software development in this comprehensive guide for beginners. Discover what software development is and why it matters, delve into key concepts, uncover the crucial steps in the development process, and learn how software shapes industries and technologies.
Learn more
What is an SDK?
Discover what SDKs are, how they work, their purpose, benefits, common tools, and use cases. Get insights into how SDKs help streamline the development process and enhance application functionality.
Learn more
What is Open Source Software (OSS)?
Open source software (OSS) refers to software that features freely available source code, which users may view, modify, adopt, and share for both commercial and noncommercial purposes.
Learn more
What is an integrated development environment (IDE)?
Uncover how IDEs help streamline software development and accelerate software delivery.
Learn more
What is a CLI (command-line interface)?
Learn how CLIs streamline tasks, automate workflows, and boost precision in your work.
Learn more
An introduction to innersource
Organizations worldwide are incorporating open source methodologies into the way they build and ship their own software.
Learn more
What is prompt engineering?
Prompt engineering is the practice of crafting effective instructions that guide AI models to produce accurate, useful results.
Learn more
What is software architecture?
Learn how software architecture helps developers build scalable, efficient systems using best practices, key components, and common styles and patterns.
Learn more
What is open source AI?
Open source AI offers more control, clarity, and room to build the way you want.
Learn more
What is Version Control?
Learn how version control systems and software help track changes, support collaboration, and ensure code integrity throughout the development process.
Learn more
What is technical debt?
Understand the impact of technical debt on software development. Learn how to manage and mitigate technical debt for long-term code quality and maintainability.
Learn more
Previous12Next
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/resources/articles?topic=software-development
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fresources%2Farticles%3Ftopic%3Dsoftware-development
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## GitHub Articles • Technical Guides, Developer Insights & Best Practices · GitHub

- Source URL: https://github.com/resources/articles?topic=devops
- Crawl depth: 1

GitHub Articles • Technical Guides, Developer Insights & Best Practices · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
GitHub Articles
Filters (1)
Open Filters
Topic
Topic
AI
Software Development
Security
DevOps
Clear allApply
The fundamentals of continuous integration in DevOps
What is continuous integration in DevOps? Continuous integration (CI) is a foundational DevOps practice where development teams integrate code changes from multiple contributors into a shared repository. Automation is used throughout this process to merge, build, and test code to facilitate a higher speed of software development. This process is often called a CI pipeline. When implemented properly, CI enables organizations to quickly identify defects and ship higher-quality software faster.
Learn more
What is a DevOps pipeline? A complete guide
A DevOps pipeline combines processes, tooling, and automation to enable organizations and software teams to build, test, and deliver high-quality software quickly to end users.
Learn more
What is DevSecOps?
DevSecOps blends development, security, and operations into a unified approach that empowers teams to deliver secure, high-quality software at speed. By fostering a culture of shared responsibility and integrating automated security checks into the development lifecycle, DevSecOps helps catch vulnerabilities early without slowing innovation.
Learn more
What is CI/CD?
Building automated workflows for faster releases
Learn more
What is a DevOps engineer and what does a DevOps engineer do?
A DevOps engineer optimizes an organization’s software delivery process to enable collaboration and innovation. Keep reading to learn more about what DevOps engineers do and what skills they rely on.
Learn more
What is DevOps?
Discover what DevOps means and how it helps teams build higher-quality software faster through increased automation and collaboration.
Learn more
What is an integrated development environment (IDE)?
Uncover how IDEs help streamline software development and accelerate software delivery.
Learn more
What is AIOps?
AI for IT operations (AIOps) uses AI to help IT teams reduce downtime and scale operations.
Learn more
What is application modernization?
Boost performance, strengthen security, and help developers ship faster by modernizing legacy systems.
Learn more
What is Infrastructure as Code (IaC)?
Treat servers like code and turn deployment chaos into predictable, automated precision.
Learn more
What is DevOps automation?
DevOps automation is a modern approach to software development that uses tools and processes to automate tasks and streamline workflows. It brings together developers, IT operations, and security teams to help them collaborate effectively and deliver reliable software. With DevOps automation, organizations are able to handle repetitive tasks, optimize processes, and deploy applications to production faster.
Learn more
What is agile methodology?
Learn what agile is, its benefits, why it’s so popular, and how you can apply it in software development and other kinds of work.
Learn more
Previous12Next
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/resources/articles?topic=devops
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fresources%2Farticles%3Ftopic%3Ddevops
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## GitHub Articles • Technical Guides, Developer Insights & Best Practices · GitHub

- Source URL: https://github.com/resources/articles?topic=security
- Crawl depth: 1

GitHub Articles • Technical Guides, Developer Insights & Best Practices · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
GitHub Articles
Filters (1)
Open Filters
Topic
Topic
AI
Software Development
Security
DevOps
Clear allApply
What is static application security testing (SAST)?
SAST enables developers to uncover security threats earlier in the development process, thereby safeguarding an application’s successful deployment.
Learn more
What is software composition analysis (SCA)?
Discover how software composition analysis (SCA) tools improve the security, quality, and efficiency of your open source software.
Learn more
What is risk-based vulnerability management (RBVM)?
Discover how risk-based vulnerability management (RBVM) helps organizations focus on the most critical security risks to optimize protection and allocate resources effectively.
Learn more
What is a Data Breach?
Discover how data breaches occur, their impact on businesses, and the industries most at risk. Learn about common attack methods and tools and best practices for securing sensitive data.
Learn more
What is a software bill of materials (SBOM)?
Software is built in layers. An SBOM shows what’s inside—so you can secure it.
Learn more
What is AIOps?
AI for IT operations (AIOps) uses AI to help IT teams reduce downtime and scale operations.
Learn more
What is application modernization?
Boost performance, strengthen security, and help developers ship faster by modernizing legacy systems.
Learn more
What is vulnerability scanning?
Vulnerability scanning is a proactive security assessment process that’s used to identify security weaknesses and vulnerabilities within software applications, networks, or systems. Vulnerability scanners are software applications that automatically scan and assess various aspects of systems, devices, code, configurations, and dependencies connected to a network, as well as operating systems running on those devices and related attributes like user accounts and permissions, services, and open ports.
Learn more
What is threat modeling?
Threat modeling is a structured approach to identifying, analyzing, and mitigating security risks in software applications and IT systems before they become vulnerabilities.
Learn more
What is software supply chain security?
Learn how software supply chain security helps organizations protect the safety, reliability, and integrity of their software supply chains from cybersecurity threats.
Learn more
What is shift left?
Shift left is a pivotal practice in software development that reduces costs, drives efficiency, and strengthens application security across the software development lifecycle. Discover how this approach helps teams find and fix software issues early, accelerating development, and improving software quality.
Learn more
What is security testing?
Read this guide to learn about the types of security testing along with best practices and trends for greater software security. You’ll explore the role of automated security testing tools, including AI-powered tools, and see the importance of incorporating security testing into every phase of software development.
Learn more
Previous12Next
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/resources/articles?topic=security
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fresources%2Farticles%3Ftopic%3Dsecurity
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## GitHub Articles • Technical Guides, Developer Insights & Best Practices · GitHub

- Source URL: https://github.com/resources/articles
- Crawl depth: 1

GitHub Articles • Technical Guides, Developer Insights & Best Practices · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
GitHub Articles
Filters
Open Filters
Topic
Topic
AI
Software Development
Security
DevOps
Clear allApply
What is an API?
APIs act as bridges between different pieces of software, enabling them to communicate, share data, and work together.
Learn more
What Is Vibe Coding?
Turn ideas into code faster with plain language prompts and agentic AI support.
Learn more
What is software development?
Explore the world of software development in this comprehensive guide for beginners. Discover what software development is and why it matters, delve into key concepts, uncover the crucial steps in the development process, and learn how software shapes industries and technologies.
Learn more
The fundamentals of continuous integration in DevOps
What is continuous integration in DevOps? Continuous integration (CI) is a foundational DevOps practice where development teams integrate code changes from multiple contributors into a shared repository. Automation is used throughout this process to merge, build, and test code to facilitate a higher speed of software development. This process is often called a CI pipeline. When implemented properly, CI enables organizations to quickly identify defects and ship higher-quality software faster.
Learn more
What is a DevOps pipeline? A complete guide
A DevOps pipeline combines processes, tooling, and automation to enable organizations and software teams to build, test, and deliver high-quality software quickly to end users.
Learn more
What is DevSecOps?
DevSecOps blends development, security, and operations into a unified approach that empowers teams to deliver secure, high-quality software at speed. By fostering a culture of shared responsibility and integrating automated security checks into the development lifecycle, DevSecOps helps catch vulnerabilities early without slowing innovation.
Learn more
What is CI/CD?
Building automated workflows for faster releases
Learn more
AI coding tools for beginner and expert coders
How beginner and expert coders use AI coding tools to code faster and ship great software.
Learn more
What is an SDK?
Discover what SDKs are, how they work, their purpose, benefits, common tools, and use cases. Get insights into how SDKs help streamline the development process and enhance application functionality.
Learn more
What is a DevOps engineer and what does a DevOps engineer do?
A DevOps engineer optimizes an organization’s software delivery process to enable collaboration and innovation. Keep reading to learn more about what DevOps engineers do and what skills they rely on.
Learn more
What is DevOps?
Discover what DevOps means and how it helps teams build higher-quality software faster through increased automation and collaboration.
Learn more
What is Open Source Software (OSS)?
Open source software (OSS) refers to software that features freely available source code, which users may view, modify, adopt, and share for both commercial and noncommercial purposes.
Learn more
Previous1234567Next
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/resources/articles
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fresources%2Farticles
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## Customer stories · GitHub

- Source URL: https://github.com/customer-stories
- Crawl depth: 1

Customer stories · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Customer Stories
Enterprise
Team
All stories
Start a free trial
Meet the companies who build with GitHub
See all stories
How GM accelerated software delivery and strengthened engineering culture with GitHub.
Read the story
How AstraZeneca accelerates medicine discovery with GitHub and AI.
Read the story
Cathay embraces AI-powered development to deliver securely at scale.
Read the story
The world's largest developer platform
Leading organizations choose GitHub to plan, build, secure and ship software.
180M+
Developers
90%
Fortune 100
4M+
Organizations
Businesses that utilize GitHub Enterprise:
GitHub Enterprise provides an end-to-end developer platform to accelerate businesses.
Industry
All
Advertising & Marketing
Automotive
Education
Energy & Utilities
Financial services
Food & Beverage
Government
Healthcare & Life Sciences
Manufacturing
Media & Entertainment
Nonprofit
Professional services
Real Estate
Retail & ecommerce
Social & Messaging
Software, Hardware & Technology
Telecommunications
Transportation & Logistics
Travel & Hospitality
Feature
All
GitHub Actions
GitHub Advanced Security
GitHub Codespaces
GitHub Copilot
GitHub Discussions
GitHub Enterprise
GitHub Expert Services
GitHub Issues
GitHub Packages
GitHub Team
Region
All
Americas
Asia Pacific
Europe
Middle East & Africa
Size
Startup
Growth
Enterprise
Learn more about Enterprise
View Enterprise stories
Read more about Wealthsimple's customer story
Wealthsimple
Wealthsimple mitigates developer toil with GitHub Actions.
Read story
Read more about Etsy's customer story
Etsy
Etsy migrated to the cloud to focus their craft on customers, not infrastructure.
Read story
Read more about C.H. Robinson's customer story
C.H. Robinson
C.H. Robinson builds DevOps success that grows with their team.
Read story
Read more about EY's customer story
EY
EY combines GitHub and Microsoft Azure DevOps to keep developers on the cutting edge.
Read story
Read more about Itaú 's customer story
Itaú
Itaú delivers software faster with GitHub Enterprise.
Read story
Read more about Plaid's customer story
Plaid
Plaid’s Developer Efficiency team speeds up workflows with developer happiness—and GitHub—at the heart of their operation.
Read story
GitHub Enterprise
Duolingo empowers its engineers to be force multipliers for expertise with GitHub Copilot.
Read more about Duolingo and GitHub's story
Read story
25%
increase in developer speed with GitHub Copilot
1m
set-up time for largest repo with Codespaces
67%
decrease in median code review turnaround time
70%
increase in pull requests
Problem
Inconsistent standards and workflows limited developer mobility and efficiency, limiting Duolingo’s ability to expand its content and deliver on its core mission.
Solution
GitHub Copilot, Codespaces, and custom API integrations enforce code consistency, accelerate developer speed, and remove the barriers to using engineering as a force multiplier for expertise.
Discover how high-growth companies innovate faster with GitHub Team.
Industry
All
Advertising & Marketing
Automotive
Education
Energy & Utilities
Financial services
Food & Beverage
Government
Healthcare & Life Sciences
Manufacturing
Media & Entertainment
Nonprofit
Professional services
Real Estate
Retail & ecommerce
Social & Messaging
Software, Hardware & Technology
Telecommunications
Transportation & Logistics
Travel & Hospitality
Feature
All
GitHub Actions
GitHub Advanced Security
GitHub Codespaces
GitHub Copilot
GitHub Discussions
GitHub Enterprise
GitHub Expert Services
GitHub Issues
GitHub Packages
GitHub Team
Region
All
Americas
Asia Pacific
Europe
Middle East & Africa
Size
Startup
Growth
Enterprise
Learn more about Team
View Team stories
Read more about Buffer's customer story
Buffer
Buffer goes from siloed to synced for better production releases.
Read story
Read more about Cesium's customer story
Cesium
Cesium leverages an open source community to support the development of 3D geospatial applications.
Read story
Read more about Front's customer story
Front
Front takes the work out of their workflows with GitHub Team.
Read story
Read more about Knock's customer story
Knock
Knock pivots to new products, with the help of GitHub’s fast, flexible developer workflows.
Read story
Read more about Modsy's customer story
Modsy
Modsy leverages GitHub Team to make interior design easy and accessible for all.
Read story
Read more about Netdata's customer story
Netdata
Netdata accelerates their developer workflow with built-in security and open source.
Read story
Here's what software leaders have to say about GitHub
Testimonials from our developers.
1 / 4
1 of 4
“
At Uber, we continuously strive to improve our developer experience. We migrated code hosting and review to GitHub and are adopting GitHub Copilot to boost overall developer productivity.
Ali-Reza Adl-Tabatabai
Senior Director of Engineering
@ Uber
“
GitHub's endless plug-ins, beautiful UI, and optimized workflows make devs happy. Happy and empowered engineers write the best code, make better decisions, and have more time to innovate.
Jen Peck
Senior Director of Engineering
@ Redfin
“
GitHub Copilot will bring huge benefits to our engineering teams by reducing the amount of time spent on boilerplate code, keeping the teams in their flow state, allowing them to ship high-quality products to market faster.
Santosh Lolyeker
VP, Engineering Fellow
@ Veritas
“
With GitHub Enterprise, we have alleviated engineering overhead at Costco, enabling our engineers to focus on innovating.
Avdesh Rai
Enterprise Solutions Engineer
@ Costco
What will your story be?
Start collaborating with your team on GitHub
Free
The basics for individuals and organizations
$0 USD per month
Create a free organization
Team
Advanced collaboration for individuals and organizations
$4 USD per month
Continue with Team
Enterprise
Security, compliance, and flexible deployment
$21 USD per month
Enterprise
Want to use GitHub on your own?
Check out our plans for individuals
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/customer-stories
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fcustomer-stories
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## Upcoming GitHub events, webinars & developer conferences · GitHub

- Source URL: https://github.com/resources/events
- Crawl depth: 1

Upcoming GitHub events, webinars & developer conferences · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Events & Webinars
Discover upcoming GitHub events, webinars, and conferences. Connect with developers, explore new tools, and learn how to build, secure, and scale software with GitHub.
Filters
Open Filters
Region
Region
AMER
EMEA
APAC
Type
Type
Virtual
In Person
Availability
Availability
Live
On demand
Topic
Topic
AI
Security
DevOps
Clear allApply
Sort by:Selecting a sort option will reload the page.
Date (soonest)
GitHub Summerfest is back for its fifth anniversary!
Whether you’re looking to catch up on what’s new on GitHub, see what to try next, or just enjoy the Summerfest vibes with the community, there’s something for you.
Online
June 16, 2026
Learn more
Copilot management: Set up and roll out at scale
Built for platform owners and enterprise admins managing AI at scale, this session focuses on what it takes to run and govern a high-volume rollout.
Online
June 10, 2026
Learn more
From Azure DevOps to GitHub: Unlock Agentic AI with Enterprise Live Migration
We'll introduce Enterprise Live Migration, enabling near-zero downtime migrations from Azure DevOps to GitHub Enterprise Cloud.
June 16, 4:00 PM CEST
Register
GitHub Roadmap Webinar, Q2 2026 | AMER + EMEA
Join GitHub's Chief Product Officer for a Q2 2026 roadmap session exploring the latest innovations shaping the future of software development from GitHub.
Online
June 18, 2026
Register Now
GitHub After Dark Bangkok
An exclusive evening built for enterprise developers to connect with peers, explore the latest GitHub updates, and discover practical AI possibilities
June 18 2026 | Hard Rock Cafe Bangkok
Register now
Optimize GitHub Copilot Token Costs
A webinar co-hosted with Andela, designed for technology and finance leaders managing AI coding costs.
Online
June 23 & July 16, 2026
Register Now
GitHub Roadmap Webinar, Q2 2026 | Asia Pacific
Join GitHub's Product Chief of Staff for a Q2 2026 roadmap session exploring the latest innovations shaping the future of software development from GitHub.
Online
June 23, 2026
Register Now
Copilot in action: Best practices and use cases for teams
Built for teams already using GitHub Copilot and ready to get more value, this interactive session breaks down how top teams are using Copilot today.
Online
June 24, 2026
Register now
GitHub Roadmap Webinar Q1 2026
The future of the AI-powered SDLC: Velocity, quality, and governance at scale.
On-demand webinar
Learn more
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/resources/events
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fresources%2Fevents
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/whitepapers
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## Ebooks & Whitepapers · GitHub

- Source URL: https://github.com/resources/whitepapers
- Crawl depth: 1

Ebooks & Whitepapers · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Ebooks & Whitepapers
Browse our collection of Ebooks and Whitepapers for valuable industry knowledge, trends, and strategies to help you stay ahead and make informed decisions.
Filters
Open Filters
Content Type
Content Type
Whitepapers
Ebooks
Category
Category
AI
Cloud
DevOps
GitHub Actions
GitHub Advanced Security
GitHub Enterprise
Innersource
Open Source
Security
Software Development
Clear allApply
Whitepaper
GitHub recognized as a Leader by 2026 Gartner® Magic Quadrant™ for Enterprise AI Coding Agents
Learn why Gartner positioned GitHub as a Leader in the Magic Quadrant™ for Enterprise AI Coding Agents for the third year in a row — and highest in Ability to Execute.
Learn more
Ebook
How to bolster security to keep pace with AI-driven development
Learn how leading security and engineering teams are closing the gap between vulnerabilities found and vulnerabilities fixed without slowing delivery, plus practical strategies for navigating AI development at scale.
Learn more
Ebook
How to orchestrate AI agents
AI agents are shifting from synchronous support tools to autonomous contributors that can refactor code, generate tests, and run maintenance work asynchronously. But once teams adopt parallel, multi-agent workflows, constraints change: preventing drift, duplicated effort, merge conflicts, and inconsistent architectural decisions becomes the real work.
Learn more
Ebook
Run high-impact hackathons with GitHub Copilot
Plan and run internal hackathons that deliver real outcomes. This playbook gives you a clear, step-by-step framework to help your teams build useful projects, learn faster, and drive innovation with GitHub Copilot.
Learn more
Ebook
Making AI work at scale for Engineering teams
Why a unified platform outperforms fragmented tools
Learn more
Ebook
AI-driven application modernization
Rewrite your modernization approach, not your code
Learn more
Whitepaper
How to Capture AI-Driven Productivity Gains Across the SDLC
Discover the Gartner® roadmap for achieving 25% to 30% productivity gains by applying AI across the entire software development lifecycle.
Learn more
Whitepaper
GitHub recognized as a Leader in the Gartner® Magic Quadrant™ for AI Code Assistants
Learn why Gartner positioned GitHub as a Leader for the second year in a row—highest and furthest in both Ability to Execute and Completeness of Vision.
Learn more
Ebook
Balancing Innovation with Governance: A Roadmap for AI-Powered Government
This whitepaper provides a clear roadmap for navigating this new landscape, showing how GitHub’s AI-powered platform can empower your teams and strengthen governance.
Learn more
Ebook
Agentic AI, Security, and DevOps: Meet GitHub
Explore strategies on how to use GitHub tools to help your teams be more productive, efficient, and happy at work.
Learn more
Whitepaper
Unlock 376% ROI with GitHub Enterprise Cloud
Read the full Forrester TEI study and use the interactive ROI calculator to model results for your organization.
Learn more
Whitepaper
Turn developer workflows into a security powerhouse with GitHub
The Forrester Industry Spotlight on GitHub Advanced Security shows how enterprises achieve measurable gains in security efficiency, risk reduction, and developer productivity.
Learn more
Previous12345Next
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/resources/whitepapers
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fresources%2Fwhitepapers
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/solutions/executive-insights
- https://github.com/orgs/community/discussions

---

## Solutions | Executive Insights · GitHub

- Source URL: https://github.com/solutions/executive-insights
- Crawl depth: 1

Solutions | Executive Insights · GitHub
Skip to content
Navigation Menu
Toggle navigation
Sign in
Platform
AI CODE CREATION
GitHub CopilotWrite better code with AI
GitHub Copilot appDirect agents from issue to merge
MCP RegistryNewIntegrate external tools
DEVELOPER WORKFLOWS
ActionsAutomate any workflow
CodespacesInstant dev environments
IssuesPlan and track work
Code ReviewManage code changes
APPLICATION SECURITY
GitHub Advanced SecurityFind and fix vulnerabilities
Code securitySecure your code as you build
Secret protectionStop leaks before they start
EXPLORE
Why GitHub
Documentation
Blog
Changelog
Marketplace
View all features
Solutions
BY COMPANY SIZE
Enterprises
Small and medium teams
Startups
Nonprofits
BY USE CASE
App Modernization
DevSecOps
DevOps
CI/CD
View all use cases
BY INDUSTRY
Healthcare
Financial services
Manufacturing
Government
View all industries
View all solutions
Resources
EXPLORE BY TOPIC
AI
Software Development
DevOps
Security
View all topics
EXPLORE BY TYPE
Customer stories
Events & webinars
Ebooks & reports
Business insights
GitHub Skills
SUPPORT & SERVICES
Documentation
Customer support
Community forum
Trust center
Partners
View all resources
Open Source
COMMUNITY
GitHub SponsorsFund open source developers
PROGRAMS
Security Lab
Maintainer Community
Accelerator
GitHub Stars
Archive Program
REPOSITORIES
Topics
Trending
Collections
Enterprise
ENTERPRISE SOLUTIONS
Enterprise platformAI-powered developer platform
AVAILABLE ADD-ONS
GitHub Advanced SecurityEnterprise-grade security features
Copilot for BusinessEnterprise-grade AI features
Premium SupportEnterprise-grade 24/7 support
Pricing
Search or jump to...
Search code, repositories, users, issues, pull requests...
Search
Clear
Search syntax tips
Provide feedback
We read every piece of feedback, and take your input very seriously.
Include my email address so I can be contacted
Cancel
Submit feedback
Saved searches
Use saved searches to filter your results more quickly
Name
Query
To see all available qualifiers, see our documentation.
Cancel
Create saved search
Sign in
Sign up
Resetting focus
You signed in with another tab or window. Reload to refresh your session.
You signed out in another tab or window. Reload to refresh your session.
You switched accounts on another tab or window. Reload to refresh your session.
Dismiss alert
{{ message }}
Solutions
Business Content
Business insights, curated just for you
Industry insights
See all articles
Pricing changes for GitHub Actions
Starting today, we’re charging fairly for Actions across the board which reduces the price of GitHub Hosted Runners and the price the average GitHub customer pays.
Learn more
How to Capture AI-Driven Productivity Gains Across the SDLC
Discover the Gartner® roadmap for achieving 25% to 30% productivity gains by applying AI across the entire software development lifecycle.
Learn more
GitHub recognized as a Leader in the Gartner® Magic Quadrant™ for AI Code Assistants
Learn why Gartner positioned GitHub as a Leader for the second year in a row—highest and furthest in both Ability to Execute and Completeness of Vision.
Learn more
Playbook series: Activating your internal AI champions
Buying AI tools without empowering people to use them is a fast track to failure. That’s where advocates come in. They’re the human bridge between strategy and execution.
Learn more
GitHub recognized as a Leader by IDC MarketScape
GitHub was named a Leader in the IDC MarketScape for AI Coding and Software Engineering Technologies.
Learn more
GitHub’s internal playbook for building an AI-powered workforce
The strategies detailed here are the product of GitHub's internal AI for Everyone initiative, which guides our company's efforts to embed AI into the fabric of how we work.
Learn more
Customer stories
3M transforms its software toolchain to bring cutting-edge science to customers, faster.
Read story
Philips builds and deploys digital health technology faster with innersource on GitHub.
Read story
GitHub brings DevOps to life and enables streamlined developer experiences at Procter & Gamble.
Read story
90% of Fortune 100 choose GitHub
433% ROI with GitHub Enterprise
77,000 organizations use GitHub Copilot
75% Reduced time spent managing tools.
Maximize your investment in AI
Our recent study with Accenture shows that AI-driven tools like GitHub Copilot, when integrated into daily workflows, can significantly boost productivity, job satisfaction, and overall code quality without adding complexity.
Learn moreContact sales
Site-wide Links
Subscribe to our developer newsletter
Get tips, technical guides, and best practices. Twice a month.
Subscribe
Platform
Features
Enterprise
Copilot
AI
Security
Pricing
Team
Resources
Roadmap
Compare GitHub
Ecosystem
Developer API
Partners
Education
GitHub CLI
GitHub Desktop
GitHub Mobile
GitHub Marketplace
MCP Registry
Support
Docs
Community Forum
Professional Services
Premium Support
Skills
Status
Contact GitHub
Company
About
Why GitHub
Customer stories
Blog
The ReadME Project
Careers
Newsroom
Inclusion
Social Impact
Shop
© 2026 GitHub, Inc.
Terms
Privacy
(Updated 02/2024)02/2024
Sitemap
What is Git?
Manage cookies
Do not share my personal information
GitHub on LinkedIn
GitHub on Instagram
GitHub on YouTube
GitHub on X
GitHub on TikTok
GitHub on Twitch
GitHub’s organization on GitHub
English
Select language
English
Português (Brasil)
Español (América Latina)
日本語
한국어
Français
Deutsch
You can’t perform that action at this time.

### Links
- https://github.com/solutions/executive-insights
- https://github.com/
- https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fsolutions%2Fexecutive-insights
- https://github.com/features/copilot
- https://github.com/features/ai/github-app
- https://github.com/mcp
- https://github.com/features/actions
- https://github.com/features/codespaces
- https://github.com/features/issues
- https://github.com/features/code-review
- https://github.com/security/advanced-security
- https://github.com/security/advanced-security/code-security
- https://github.com/security/advanced-security/secret-protection
- https://github.com/why-github
- https://github.com/marketplace
- https://github.com/features
- https://github.com/enterprise
- https://github.com/team
- https://github.com/enterprise/startups
- https://github.com/solutions/industry/nonprofits
- https://github.com/solutions/use-case/app-modernization
- https://github.com/solutions/use-case/devsecops
- https://github.com/solutions/use-case/devops
- https://github.com/solutions/use-case/ci-cd
- https://github.com/solutions/use-case
- https://github.com/solutions/industry/healthcare
- https://github.com/solutions/industry/financial-services
- https://github.com/solutions/industry/manufacturing
- https://github.com/solutions/industry/government
- https://github.com/solutions/industry
- https://github.com/solutions
- https://github.com/resources/articles?topic=ai
- https://github.com/resources/articles?topic=software-development
- https://github.com/resources/articles?topic=devops
- https://github.com/resources/articles?topic=security
- https://github.com/resources/articles
- https://github.com/customer-stories
- https://github.com/resources/events
- https://github.com/resources/whitepapers
- https://github.com/orgs/community/discussions