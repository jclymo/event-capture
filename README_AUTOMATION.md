## ServiceNow Automation with Task Recorder

This guide explains how to run the ServiceNow automation so it drives the browser while the Task Recorder extension captures events (including HTML snapshots) and syncs them to Mongo.

### Steps

1. **Install all requirements**
   - Server deps:
     ```bash
     python3 -m pip install -r server/requirements.txt
     ```
   - Automation deps:
     ```bash
     python3 -m pip install -r testing_script_folder/requirements.txt
     ```

2. **Start Chrome with remote debugging and a clean profile**
   ```bash
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
     --remote-debugging-port=9222 \
     --user-data-dir=/tmp/chrome-recorder
   ```
   - Load the Task Recorder extension in this Chrome instance.

3. **Run the backend server**
   ```bash
   server/.venv/bin/python -m uvicorn server.server:app \
     --host 0.0.0.0 --port 3000 --reload
   ```

4. **Open ServiceNow in Chrome**
   - In the debug-enabled Chrome window, go to:  
     `https://empmassimo23.service-now.com/navpage.do`

5. **Start recording in the extension**
   - Use the Task Recorder popup to begin a new recording session.

6. **Run the automation driver**
   ```bash
   python3 testing_script_folder/drive_filter_with_extension.py
   ```
   - This script connects to Chrome over CDP (`localhost:9222`) and drives the filter task while the extension records events.

7. **Stop recording and sync to Mongo**
   - Stop recording from the extension popup.
   - Click “Sync to Mongo” (or use the details view) so the recorded task is sent to the backend and stored (with HTML uploaded if configured).

