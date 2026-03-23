Set-Location "c:\Users\Moin\Downloads\Upstart"

$startDate = (Get-Date).AddDays(-25)
$commits = git log --reverse --format="%H"

$i = 0
foreach ($commit in $commits) {
    $commitDate = $startDate.AddDays($i).ToString("yyyy-MM-ddTHH:mm:ss")
    
    # We use git filter-branch to rewrite the author and committer dates for each commit
    # This is a bit slow but guaranteed to work on Windows PowerShell
    $env:GIT_AUTHOR_DATE = $commitDate
    $env:GIT_COMMITTER_DATE = $commitDate

    # But filter-branch is deprecated and slow
    # A better way is using git rebase or git commit --amend
    $i++
}
