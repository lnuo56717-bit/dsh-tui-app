param(
  [Parameter(Mandatory = $true)]
  [string]$ReadyPath,
  [Parameter(Mandatory = $true)]
  [string]$ResultPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = [Windows.Forms.Form]::new()
$form.Text = 'dsh CUA Fixture'
$form.Name = 'DshCuaFixture'
$form.StartPosition = 'Manual'
$form.Location = [Drawing.Point]::new(80, 80)
$form.Size = [Drawing.Size]::new(520, 260)
$form.TopMost = $false

$heading = [Windows.Forms.Label]::new()
$heading.Text = 'Safe local computer-control gate'
$heading.AccessibleName = 'Fixture heading'
$heading.Location = [Drawing.Point]::new(24, 22)
$heading.AutoSize = $true

$input = [Windows.Forms.TextBox]::new()
$input.Name = 'GateInput'
$input.AccessibleName = 'Gate input'
$input.Location = [Drawing.Point]::new(24, 62)
$input.Size = [Drawing.Size]::new(450, 28)

$button = [Windows.Forms.Button]::new()
$button.Name = 'ApplyButton'
$button.Text = 'Apply'
$button.AccessibleName = 'Apply fixture value'
$button.Location = [Drawing.Point]::new(24, 106)
$button.Size = [Drawing.Size]::new(110, 34)

$result = [Windows.Forms.Label]::new()
$result.Name = 'GateResult'
$result.Text = 'waiting'
$result.Location = [Drawing.Point]::new(24, 160)
$result.Size = [Drawing.Size]::new(450, 30)

$button.Add_Click({
  $result.Text = 'clicked'
  [IO.File]::WriteAllText($ResultPath, $result.Text, [Text.UTF8Encoding]::new($false))
})
$form.Controls.AddRange(@($heading, $input, $button, $result))
$form.Add_Shown({
  $payload = [ordered]@{ pid = $PID; window_id = $form.Handle.ToInt64(); title = $form.Text }
  [IO.File]::WriteAllText($ReadyPath, ($payload | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
})
$form.Add_FormClosed({ [Windows.Forms.Application]::ExitThread() })
[Windows.Forms.Application]::Run($form)
