$file = 'C:\Users\ttibu\Documents\06_PRODUTIVIDADE\dashboard.html'
$bytes = [System.IO.File]::ReadAllBytes($file)

# Bad regex bytes: [^\x00-\x7f\xc3\x80-\xc9\x8f]
$bad  = [byte[]]@(0x5b, 0x5e, 0x00, 0x2d, 0x7f, 0xc3, 0x80, 0x2d, 0xc9, 0x8f, 0x5d)
# Good: [^ -ɏ] - space (0x20) through ɏ (U+024F encoded as c9 8f) - negated
$good = [System.Text.Encoding]::UTF8.GetBytes('[^ -' + [char]0x024F + ']')

$pos = -1
for ($i = 0; $i -le $bytes.Length - $bad.Length; $i++) {
    $match = $true
    for ($j = 0; $j -lt $bad.Length; $j++) {
        if ($bytes[$i+$j] -ne $bad[$j]) { $match = $false; break }
    }
    if ($match) { $pos = $i; break }
}

if ($pos -ge 0) {
    Write-Host "Found at byte position $pos"
    $newBytes = New-Object byte[] ($bytes.Length - $bad.Length + $good.Length)
    [Array]::Copy($bytes, 0, $newBytes, 0, $pos)
    [Array]::Copy($good, 0, $newBytes, $pos, $good.Length)
    [Array]::Copy($bytes, $pos + $bad.Length, $newBytes, $pos + $good.Length, $bytes.Length - $pos - $bad.Length)
    [System.IO.File]::WriteAllBytes($file, $newBytes)
    Write-Host "Fixed and saved!"
} else {
    Write-Host "Pattern NOT found - checking nearby bytes..."
    # Show bytes around the regex area
    $line4694 = 4693
    $lineCount = 0
    $bytePos = 0
    for ($i = 0; $i -lt $bytes.Length; $i++) {
        if ($bytes[$i] -eq 0x0a) { $lineCount++; if ($lineCount -eq $line4694) { $bytePos = $i + 1; break } }
    }
    Write-Host "Line 4694 starts at byte $bytePos"
    Write-Host "Bytes: $($bytes[$bytePos..($bytePos+100)] | ForEach-Object { $_.ToString('X2') })"
}
