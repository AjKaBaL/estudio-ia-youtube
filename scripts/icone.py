"""Gera recursos/icone.ico (atalho do app) a partir do desenho original do apresentador: só a cabeça, em várias resoluções."""
from pathlib import Path
from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
arte = Image.open(RAIZ / "recursos" / "apresentador" / "apresentando-fechada.png").convert("RGBA")
# A cabeça fica entre x 66–294 e y 14–256 no desenho de 360×480; recorte quadrado com folga.
cabeca = arte.crop((50, 10, 310, 270))
fundo = Image.new("RGBA", cabeca.size, (0, 0, 0, 0))
fundo.alpha_composite(cabeca)
fundo.save(RAIZ / "recursos" / "icone.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("ok")
