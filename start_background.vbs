Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
strCurrentDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Run start.bat silently in background (0 = hidden window)
WshShell.CurrentDirectory = strCurrentDir
WshShell.Run "cmd /c """ & strCurrentDir & "\start.bat""", 0, False
