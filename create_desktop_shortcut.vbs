Set WshShell = CreateObject("WScript.Shell")
strDesktop = WshShell.SpecialFolders("Desktop")
strScriptPath = WshShell.CurrentDirectory & "\start.bat"

Set oShellLink = WshShell.CreateShortcut(strDesktop & "\ProcSnap.lnk")
oShellLink.TargetPath = strScriptPath
oShellLink.WorkingDirectory = WshShell.CurrentDirectory
oShellLink.Description = "ProcSnap - Workflow Studio"
oShellLink.IconLocation = "shell32.dll, 220"
oShellLink.Save
