$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class FixtureNative {
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [StructLayout(LayoutKind.Sequential, Size=40)] public struct INPUT { public uint type; public KI ki; }
  [StructLayout(LayoutKind.Sequential)] public struct KI { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  public static bool Key(ushort key, bool up) {
    var input = new INPUT { type=1, ki=new KI { wVk=key, dwFlags=up ? 2u : 0u } };
    return SendInput(1, new [] { input }, Marshal.SizeOf(typeof(INPUT))) == 1;
  }
  public static void Gesture(IntPtr expectedWindow, string mode) {
    new Thread(() => {
      Thread.Sleep(50);
      if (GetForegroundWindow() != expectedWindow) return;
      Key(0x11,false); Key(0x43,false);
      if (mode != "repeat") Key(0x43,true);
      if (mode == "single") { Key(0x11,true); return; }
      Thread.Sleep(mode == "slow" ? 800 : 100);
      if (GetForegroundWindow() != expectedWindow) { Key(0x11,true); return; }
      Key(0x43,false);
      Key(0x43,true); Key(0x11,true);
    }) { IsBackground=true }.Start();
  }
}
'@
$f=New-Object Windows.Forms.Form
$f.Text='OpenDeepL Double Copy Fixture'
$f.Width=1000;$f.Height=600;$f.StartPosition='CenterScreen'
$source=New-Object Windows.Forms.TextBox
$source.Name='OpenDeepLFixtureSource';$source.Multiline=$true;$source.ReadOnly=$true
$source.Left=25;$source.Top=25;$source.Width=930;$source.Height=180
$source.Font=New-Object Drawing.Font('Segoe UI',20)
$source.Text='Do not ship before Friday. The total is $19.99, not $9.99.'
$target=New-Object Windows.Forms.TextBox
$target.Name='OpenDeepLFixturePasteTarget';$target.Multiline=$true
$target.Left=25;$target.Top=245;$target.Width=930;$target.Height=180
$target.Font=New-Object Drawing.Font('Segoe UI',20)
$status=New-Object Windows.Forms.Label
$status.Name='OpenDeepLFixtureStatus';$status.Left=25;$status.Top=435;$status.Width=930;$status.Height=30
$status.Text='Fixture copy not yet observed'
$select=New-Object Windows.Forms.Button
$select.Name='OpenDeepLFixtureSelectSource';$select.Text='Select fixture source';$select.Left=25;$select.Top=470;$select.Width=220
$select.Add_Click({$source.Focus();$source.SelectAll();$status.Text="Fixture source selected $($source.SelectionLength) chars"})
function Start-FixtureGesture {
  $source.Focus();$source.SelectAll()
  $script:gestureTimer=New-Object Windows.Forms.Timer
  $script:gestureTimer.Interval=250
  $script:gestureTimer.Add_Tick({
    $script:gestureTimer.Stop();$script:gestureTimer.Dispose()
    if ([FixtureNative]::GetForegroundWindow() -ne $f.Handle -or -not $source.Focused -or $source.SelectionLength -ne 58 -or $source.Text -ne 'Do not ship before Friday. The total is $19.99, not $9.99.') {
      $status.Text="Fixture SendInput guard stopped; foreground=$([FixtureNative]::GetForegroundWindow() -eq $f.Handle) focus=$($source.Focused) selected=$($source.SelectionLength)"
      return
    }
    $status.Text="Fixture guarded SendInput $script:gestureMode started"
    [FixtureNative]::Gesture($f.Handle,$script:gestureMode)
  })
  $script:gestureTimer.Start()
}
$double=New-Object Windows.Forms.Button
$double.Name='OpenDeepLFixtureDoubleCopy';$double.Text='Send guarded double';$double.Left=260;$double.Top=470;$double.Width=200
$double.Add_Click({$script:gestureMode='double';Start-FixtureGesture})
$slow=New-Object Windows.Forms.Button
$slow.Name='OpenDeepLFixtureSlowCopy';$slow.Text='Send guarded slow';$slow.Left=475;$slow.Top=470;$slow.Width=200
$slow.Add_Click({$script:gestureMode='slow';Start-FixtureGesture})
$single=New-Object Windows.Forms.Button
$single.Name='OpenDeepLFixtureSingleCopy';$single.Text='Send guarded single';$single.Left=690;$single.Top=470;$single.Width=200
$single.Add_Click({$script:gestureMode='single';Start-FixtureGesture})
$repeat=New-Object Windows.Forms.Button
$repeat.Name='OpenDeepLFixtureRepeatCopy';$repeat.Text='Send guarded repeat';$repeat.Left=260;$repeat.Top=505;$repeat.Width=200
$repeat.Add_Click({$script:gestureMode='repeat';Start-FixtureGesture})
$source.Add_KeyDown({
  if ($_.Control -and $_.KeyCode -eq [Windows.Forms.Keys]::C) {
    $script:selectedBefore=$source.SelectionLength
    $script:seqBefore=[FixtureNative]::GetClipboardSequenceNumber()
    $status.Text="Fixture Ctrl+C keydown selected=$script:selectedBefore chars"
    $source.BeginInvoke([Action]{
      $after=[FixtureNative]::GetClipboardSequenceNumber()
      $status.Text="Fixture Ctrl+C selected=$script:selectedBefore chars seq_changed=$($after -ne $script:seqBefore) focused=$($source.Focused)"
    }) | Out-Null
  }
})
$f.Controls.AddRange(@($source,$target,$status,$select,$double,$slow,$single,$repeat))
$f.Add_Shown({$source.Focus();$source.SelectAll()})
[Windows.Forms.Application]::Run($f)
