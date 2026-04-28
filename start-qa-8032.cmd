@echo off
set PYTHONPATH=E:\MyPrograms\HDMS
cd /d E:\MyPrograms\HDMS\backend\qa_assistant
"E:\my_envs\HIZ\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 8032 --env-file ..\..\.env.external > "E:\MyPrograms\HDMS\qa-8032.log" 2>&1

