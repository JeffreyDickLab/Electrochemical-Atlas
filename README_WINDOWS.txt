ELECTROCHEMICAL ATLAS - WINDOWS QUICK START
===========================================

This WINDOWS PORTABLE ZIP is ready to launch on 64-bit Windows. It does not
contain the textbook PDF; select your own matching PDF when Atlas opens.

1. In File Explorer, right-click the downloaded ZIP and select Extract All.
2. Open the resulting Electrochemical-Atlas folder.
3. Make sure these files are present:
     Launch_Electrochemical_Atlas.bat
     runtime\atlas-windows-amd64.exe
     app\index.html
4. Double-click Launch_Electrochemical_Atlas.bat (not the ZIP itself).
5. On first use, Atlas may need internet access to install the PDF.js
   equation and figure cropping engine. It does not upload the selected textbook.
   If PDF.js cannot be installed, Atlas will still show the original PDF
   page as a figure fallback, rather than an empty preview. For isolated
   figures, reconnect once to enable PDF.js and use the Crop button.

If the message says "Windows runtime is missing":
- You likely used the GitHub source-code ZIP, which has no compiled EXE.
- Or you opened the .bat from inside the compressed ZIP; use Extract All.
- Or an antivirus product quarantined the EXE during extraction.
  Check Windows Security > Protection history without disabling protection.

Use GitHub SOURCE ZIPs only for development. Build the launcher using Go,
or download a PORTABLE/RELEASE ZIP to run the app.

Licensing: Atlas-owned code is MIT-licensed to the stated project authors.
PDF.js and the textbook retain their separate licensing and rights.
