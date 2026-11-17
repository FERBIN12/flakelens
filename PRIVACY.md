# FlakeLens privacy policy

FlakeLens is an open-source Forge app (https://github.com/FERBIN12/flakelens) built for Codegeist 2026.

**What it stores.** Only what your CI sends to its web trigger: test names, pass/fail/skip outcomes, failure messages
from the JUnit XML, the commit id and build id you attach, and run summaries. It also remembers which Jira issue it
filed for which test so it can comment instead of filing a duplicate. All of this lives in Forge storage on
Atlassian's platform, inside your site's installation. FlakeLens does not store Atlassian account IDs, user profiles
or any other personal data, and it does not send data to any server outside Atlassian.

**What it reads.** Jira issues it created (to add comments) and the data above. Rovo and MCP tools only read the
same stored test data.

**Deleting data.** Uninstalling the app removes its Forge storage. A single CI project can be reset with the
web trigger's DELETE request (see README).

**Contact.** Open an issue at https://github.com/FERBIN12/flakelens/issues.
