# Cria o atalho "Estúdio IA YouTube" na Área de Trabalho e no menu Iniciar.
# Abre pelo "Abrir Estudio.cmd" (prepara e abre o app), com a janela de preparo minimizada e o ícone do canal.
$pasta = Split-Path -Parent $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
foreach ($destino in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $atalho = $shell.CreateShortcut((Join-Path $destino 'Estúdio IA YouTube.lnk'))
  $atalho.TargetPath = Join-Path $pasta 'Abrir Estudio.cmd'
  $atalho.WorkingDirectory = $pasta
  $atalho.IconLocation = Join-Path $pasta 'recursos\icone.ico'
  $atalho.WindowStyle = 7
  $atalho.Description = 'Abre o Estúdio IA YouTube'
  $atalho.Save()
}
Write-Host 'Atalho "Estúdio IA YouTube" criado na Área de Trabalho e no menu Iniciar.'
