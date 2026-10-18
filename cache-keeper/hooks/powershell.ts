// Scripts the mod runs through Windows PowerShell 5.1. Each goes in as
// -EncodedCommand, so nothing in it is re-quoted on the way through a command line,
// and reports its own error as one plain line on stderr.

export const POWERSHELL = 'powershell.exe'

// Windows PowerShell's own app id, so a toast shows without registering an app.
const POWERSHELL_APP_ID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'

// A single-quoted PowerShell string. PowerShell reads ' and the curly quotes
// ‘ ’ ‚ ‛ all as single quotes, so each one is doubled.
export function psQuote(text: string): string {
  return `'${text.replace(/['‘’‚‛]/g, '$&$&')}'`
}

// base64 of the script's UTF-16LE bytes, the form -EncodedCommand takes.
export function encodeCommand(script: string): string {
  let bytes = ''
  for (let i = 0; i < script.length; i++) {
    const unit = script.charCodeAt(i)
    bytes += String.fromCharCode(unit & 0xff, unit >> 8)
  }
  return btoa(bytes)
}

export function powershellArgv(script: string): string[] {
  return [POWERSHELL, '-NoProfile', '-NonInteractive', '-EncodedCommand', encodeCommand(reportingErrors(script))]
}

// Windows PowerShell 5.1 writes its own error records to a redirected stderr as
// CLIXML when the command is encoded, whatever -OutputFormat says. So the script
// writes the error's message itself, as one plain line, and exits 1. Progress
// records would go out as CLIXML too, so they are off.
function reportingErrors(script: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    'try {',
    script,
    '} catch {',
    '  [Console]::Error.WriteLine($_.Exception.Message)',
    '  exit 1',
    '}',
  ].join('\n')
}

// The last 3 transcript lines that carry cache writes, from the last 200 lines.
export function tailScript(transcriptPath: string): string {
  return [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `Get-Content -LiteralPath ${psQuote(transcriptPath)} -Tail 200 -Encoding UTF8 | Where-Object { $_.Contains('"cache_creation":{') } | Select-Object -Last 3`,
  ].join('\n')
}

export function toastScript(title: string, body: string): string {
  return [
    '$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]',
    '$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]',
    `$title = [System.Security.SecurityElement]::Escape(${psQuote(title)})`,
    `$body = [System.Security.SecurityElement]::Escape(${psQuote(body)})`,
    '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
    '$xml.LoadXml("<toast><visual><binding template=""ToastGeneric""><text>$title</text><text>$body</text></binding></visual></toast>")',
    '$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)',
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${POWERSHELL_APP_ID}').Show($toast)`,
  ].join('\n')
}
