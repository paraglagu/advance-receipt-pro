# Runs the advance draw-down tests against a throwaway SQLite database.
#
# The app itself runs on Postgres. Prisma bakes the provider into the generated
# client, so this script swaps in a SQLite build, runs the tests, then puts the
# Postgres client back. Always run it from the project root.

$ErrorActionPreference = "Stop"
Push-Location (Split-Path $PSScriptRoot -Parent)

try {
    # Keep the SQLite schema in step with the real one.
    (Get-Content prisma\schema.prisma -Raw) -replace 'provider = "postgresql"', 'provider = "sqlite"' |
        Set-Content prisma\test.schema.prisma -NoNewline

    $env:DATABASE_URL = "file:./test.db"

    npx prisma generate --schema prisma/test.schema.prisma | Out-Null
    npx prisma db push --schema prisma/test.schema.prisma --force-reset --skip-generate | Out-Null

    npx esbuild scripts/allocation.test.mjs --bundle --platform=node --format=esm `
        --outfile=scripts/.build.test.mjs --external:@prisma/client | Out-Null

    node scripts/.build.test.mjs
    $testExit = $LASTEXITCODE
}
finally {
    Remove-Item scripts\.build.test.mjs, prisma\test.db -Force -ErrorAction SilentlyContinue
    Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
    # Put the Postgres client back so `npm run dev` isn't left pointing at SQLite.
    npx prisma generate | Out-Null
    Pop-Location
}

exit $testExit
