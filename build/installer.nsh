; Registers Vew with Windows as a web browser, so it appears in Settings > Default apps.
; Per-user install: everything lives under HKCU.

!macro customInstall
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vew" "" "Vew"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vew\DefaultIcon" "" "$INSTDIR\Vew.exe,0"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vew\shell\open\command" "" '"$INSTDIR\Vew.exe"'
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vew\Capabilities" "ApplicationName" "Vew"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vew\Capabilities" "ApplicationDescription" "Vew, the browser for the Texor family"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vew\Capabilities" "ApplicationIcon" "$INSTDIR\Vew.exe,0"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vew\Capabilities\URLAssociations" "http" "VewURL"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vew\Capabilities\URLAssociations" "https" "VewURL"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vew\Capabilities\FileAssociations" ".html" "VewHTML"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vew\Capabilities\FileAssociations" ".htm" "VewHTML"
  WriteRegStr HKCU "Software\RegisteredApplications" "Vew" "Software\Clients\StartMenuInternet\Vew\Capabilities"

  WriteRegStr HKCU "Software\Classes\VewURL" "" "Vew URL"
  WriteRegStr HKCU "Software\Classes\VewURL" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\VewURL\DefaultIcon" "" "$INSTDIR\Vew.exe,0"
  WriteRegStr HKCU "Software\Classes\VewURL\shell\open\command" "" '"$INSTDIR\Vew.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\VewHTML" "" "Vew HTML Document"
  WriteRegStr HKCU "Software\Classes\VewHTML\DefaultIcon" "" "$INSTDIR\Vew.exe,0"
  WriteRegStr HKCU "Software\Classes\VewHTML\shell\open\command" "" '"$INSTDIR\Vew.exe" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Clients\StartMenuInternet\Vew"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Vew"
  DeleteRegKey HKCU "Software\Classes\VewURL"
  DeleteRegKey HKCU "Software\Classes\VewHTML"
!macroend
