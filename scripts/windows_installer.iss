#ifndef AppVersion
  #define AppVersion "0.7.0"
#endif
#ifndef BundleDir
  #error BundleDir must point at the verified portable bundle
#endif
[Setup]
AppId={{94CF87DB-A211-4500-9E03-257C2C231DB4}
AppName=OpenDeepL
AppVersion={#AppVersion}
AppPublisher=OpenDeepL contributors
AppPublisherURL=https://github.com/HHHHHarris/OpenDeepL-updates
AppSupportURL=https://github.com/HHHHHarris/OpenDeepL-updates/issues
DefaultDirName={localappdata}\Programs\OpenDeepL
DefaultGroupName=OpenDeepL
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
UninstallDisplayIcon={app}\resources\app\assets\AppIcon.ico
SetupIconFile=..\assets\AppIcon.ico
OutputDir=..\dist
OutputBaseFilename=OpenDeepL-{#AppVersion}-windows-x64-setup
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
[Files]
Source: "{#BundleDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{autoprograms}\OpenDeepL"; Filename: "{app}\OpenDeepL.exe"; IconFilename: "{app}\resources\app\assets\AppIcon.ico"
Name: "{autodesktop}\OpenDeepL"; Filename: "{app}\OpenDeepL.exe"; IconFilename: "{app}\resources\app\assets\AppIcon.ico"; Tasks: desktopicon
[Tasks]
Name: desktopicon; Description: "Create a desktop shortcut"; Flags: unchecked
[Run]
Filename: "{app}\OpenDeepL.exe"; Description: "Open OpenDeepL"; Flags: nowait postinstall skipifsilent
; App data, downloaded models and user documents are intentionally retained.
