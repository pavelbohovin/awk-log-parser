# Local AWK WASM Test

1. Serve the project over HTTP from the repository root:

   ```bash
   python3 -m http.server 8765
   ```

2. Open `http://localhost:8765/#/workspace`.
3. Select `AWK WASM Engine`.
4. Load a log:
   - Click `Load sample log`, or
   - Upload `test-data/sample-access.log`.
5. Verify Engine Status shows:
   - `JavaScript Parser: Available`
   - `AWK WASM Engine: Available`
   - `Last WASM self-test result: awk-wasm-ok`
6. Run this self-test script:

   ```awk
   BEGIN {
     print "awk-wasm-ok"
   }
   ```

   Expected STDOUT:

   ```text
   awk-wasm-ok
   ```

7. Run the status count script:

   ```awk
   {
     status = $9
     count[status]++
   }
   END {
     print "status,count"
     for (s in count) print s "," count[s]
   }
   ```

8. Verify the Parsed CSV output table appears with `status,count` columns.
