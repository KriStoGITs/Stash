@echo off
chcp 65001 >nul
pushd "%~dp0"
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)" >nul 2>&1
if errorlevel 1 (
 echo Nepieciesams Node.js 24 vai jaunaks.
 pause
 popd
 exit /b 1
)
node -e "import('./core.js').then(({db})=>process.exit(db.prepare('SELECT COUNT(*) n FROM users').get().n ? 0 : 2))"
if errorlevel 1 (
 node setup.js
 if errorlevel 1 (
  pause
  popd
  exit /b 1
 )
 echo Saglabajiet ieprieks paraditas paroles.
 pause
)
echo Atveriet http://127.0.0.1:3000
node server.js
pause
popd
