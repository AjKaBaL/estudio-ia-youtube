"""Desenha o apresentador original do canal ("Bit") em várias poses, com boca aberta e fechada."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

S = 4
W, H = 360, 480
SAIDA = Path(__file__).resolve().parent.parent / "recursos" / "apresentador"
SAIDA.mkdir(exist_ok=True)
FONTE = r"C:\Windows\Fonts\arialbd.ttf"

VERMELHO, VERMELHO_ESC = (225, 29, 72, 255), (159, 18, 57, 255)
CINZA_CLARO, CINZA, CINZA_ESC = (243, 244, 246, 255), (156, 163, 175, 255), (55, 65, 81, 255)
TELA, CIANO, CIANO_ESC = (15, 23, 42, 255), (34, 211, 238, 255), (14, 116, 144, 255)
AMARELO, BRANCO, PRETO = (250, 204, 21, 255), (255, 255, 255, 255), (17, 24, 39, 255)


def p(*xy):
    return [v * S for v in xy]


def braco(d, ombro, cotovelo, mao, dedo=None):
    for cor, larg in ((VERMELHO_ESC, 26), (VERMELHO, 18)):
        d.line(p(*ombro, *cotovelo), fill=cor, width=larg * S)
        d.line(p(*cotovelo, *mao), fill=cor, width=larg * S)
        for c in (ombro, cotovelo):
            r = larg / 2
            d.ellipse(p(c[0] - r, c[1] - r, c[0] + r, c[1] + r), fill=cor)
    if dedo:
        d.line(p(*mao, *dedo), fill=CINZA, width=12 * S)
        d.line(p(*mao, *dedo), fill=CINZA_CLARO, width=8 * S)
    d.ellipse(p(mao[0] - 18, mao[1] - 18, mao[0] + 18, mao[1] + 18), fill=CINZA_CLARO, outline=CINZA, width=4 * S)


def olhos(d, tipo):
    for cx in (145, 215):
        if tipo == "feliz":
            d.arc(p(cx - 18, 140, cx + 18, 172), start=200, end=340, fill=CIANO, width=8 * S)
            continue
        w, h, dy = (40, 52, 0) if tipo == "arregalado" else (34, 44, -8 if tipo == "cima" else 0)
        d.ellipse(p(cx - w / 2, 150 - h / 2 + dy, cx + w / 2, 150 + h / 2 + dy), fill=CIANO)
        d.ellipse(p(cx - 13, 150 - h / 2 + 6 + dy, cx - 1, 150 - h / 2 + 18 + dy), fill=BRANCO)


def boca(d, aberta, feliz=False):
    if aberta:
        larg = 22 if feliz else 18
        d.ellipse(p(180 - larg, 180, 180 + larg, 214), fill=CIANO)
        d.ellipse(p(180 - larg + 7, 190, 180 + larg - 7, 210), fill=CIANO_ESC)
    else:
        d.arc(p(155, 172, 205, 204), start=20, end=160, fill=CIANO, width=6 * S)


def balao(d, centro, raio, texto, fundo=BRANCO, cor=VERMELHO, cauda=(1, 1)):
    cx, cy = centro
    d.ellipse(p(cx - raio, cy - raio, cx + raio, cy + raio), fill=fundo, outline=CINZA_ESC, width=4 * S)
    for i, r in enumerate((10, 6)):
        bx, by = cx + cauda[0] * (raio + 12 + i * 16), cy + cauda[1] * (raio + 6 + i * 14)
        d.ellipse(p(bx - r, by - r, bx + r, by + r), fill=fundo, outline=CINZA_ESC, width=3 * S)
    f = ImageFont.truetype(FONTE, int(raio * 1.5) * S)
    caixa = d.textbbox((0, 0), texto, font=f)
    d.text((cx * S - (caixa[2] - caixa[0]) / 2 - caixa[0], cy * S - (caixa[3] - caixa[1]) / 2 - caixa[1]), texto, font=f, fill=cor)


def lampada(d, cx, cy):
    for ang in range(0, 360, 45):
        import math
        a = math.radians(ang)
        d.line(p(cx + 34 * math.cos(a), cy + 34 * math.sin(a), cx + 46 * math.cos(a), cy + 46 * math.sin(a)), fill=AMARELO, width=5 * S)
    d.ellipse(p(cx - 24, cy - 26, cx + 24, cy + 22), fill=AMARELO, outline=(202, 138, 4, 255), width=3 * S)
    d.rectangle(p(cx - 11, cy + 20, cx + 11, cy + 34), fill=CINZA, outline=CINZA_ESC, width=2 * S)


def estrela(d, cx, cy, r):
    import math
    pontos = []
    for i in range(10):
        a = math.radians(-90 + i * 36)
        rr = r if i % 2 == 0 else r * 0.45
        pontos += [(cx + rr * math.cos(a)) * S, (cy + rr * math.sin(a)) * S]
    d.polygon(pontos, fill=AMARELO)


def corpo(d):
    d.ellipse(p(100, 451, 260, 473), fill=(0, 0, 0, 70))
    for x in (140, 195):
        d.rounded_rectangle(p(x, 400, x + 25, 452), radius=8 * S, fill=CINZA_ESC)
        d.ellipse(p(x - 8, 440, x + 33, 460), fill=CINZA_ESC)
    d.rectangle(p(165, 240, 195, 266), fill=CINZA)
    d.rounded_rectangle(p(110, 260, 250, 410), radius=40 * S, fill=VERMELHO, outline=VERMELHO_ESC, width=4 * S)
    d.ellipse(p(150, 300, 210, 360), fill=BRANCO)
    f = ImageFont.truetype(FONTE, 30 * S)
    caixa = d.textbbox((0, 0), "IA", font=f)
    d.text((180 * S - (caixa[2] - caixa[0]) / 2 - caixa[0], 330 * S - (caixa[3] - caixa[1]) / 2 - caixa[1]), "IA", font=f, fill=VERMELHO)


def cabeca(d):
    d.line(p(180, 72, 180, 38), fill=CINZA, width=6 * S)
    d.ellipse(p(168, 18, 192, 42), fill=VERMELHO, outline=VERMELHO_ESC, width=3 * S)
    for x in (78, 282):
        d.ellipse(p(x - 12, 148, x + 12, 172), fill=CINZA, outline=CINZA_ESC, width=3 * S)
    d.rounded_rectangle(p(80, 70, 280, 250), radius=60 * S, fill=CINZA_CLARO, outline=CINZA, width=5 * S)
    d.rounded_rectangle(p(100, 95, 260, 225), radius=40 * S, fill=TELA)


OMBRO_E, OMBRO_D = (118, 288), (242, 288)
BAIXO_E = ((95, 345), (100, 395))
BAIXO_D = ((265, 345), (260, 395))

POSES = {
    # pose: (braço esquerdo, braço direito, olhos, extras, boca feliz)
    "falando": (BAIXO_E, ((280, 330), (305, 285), None), "normal", None, False),
    "pergunta": (BAIXO_E, ((305, 230), (282, 150), None), "normal", "pergunta", False),
    "ideia": (BAIXO_E, ((285, 225), (292, 168), (292, 140)), "normal", "ideia", True),
    "dado": (((70, 282), (36, 276), (14, 274)), BAIXO_D, "normal", None, False),
    "alerta": (((80, 232), (68, 180), None), ((280, 232), (292, 180), None), "arregalado", "alerta", False),
    "comemorando": (((80, 220), (58, 150), None), ((280, 220), (302, 150), None), "feliz", "estrelas", True),
    "pensando": (BAIXO_E, ((285, 335), (222, 256), None), "cima", "pensando", False),
    "apresentando": (BAIXO_E, ((300, 255), (322, 192), None), "normal", None, True),
}


def desenhar(nome, aberta):
    e, dbr, olho, extra, feliz = POSES[nome]
    img = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    corpo(d)
    # Braço atrás da cabeça (pergunta/pensando) é desenhado depois da cabeça para ficar na frente.
    frente = nome in ("pergunta", "pensando", "ideia", "alerta", "comemorando")
    if not frente:
        braco(d, OMBRO_E, e[0], e[1], e[2] if len(e) > 2 else None)
        braco(d, OMBRO_D, dbr[0], dbr[1], dbr[2] if len(dbr) > 2 else None)
    cabeca(d)
    olhos(d, olho)
    boca(d, aberta, feliz)
    if frente:
        braco(d, OMBRO_E, e[0], e[1], e[2] if len(e) > 2 else None)
        braco(d, OMBRO_D, dbr[0], dbr[1], dbr[2] if len(dbr) > 2 else None)
    if extra == "pergunta":
        balao(d, (58, 70), 42, "?", cauda=(0.7, 0.8))
    elif extra == "alerta":
        balao(d, (58, 64), 40, "!", fundo=AMARELO, cor=PRETO, cauda=(0.7, 0.8))
    elif extra == "ideia":
        lampada(d, 300, 86)
    elif extra == "estrelas":
        for (x, y, r) in ((40, 110, 16), (322, 104, 14), (300, 40, 11), (60, 46, 10)):
            estrela(d, x, y, r)
    elif extra == "pensando":
        balao(d, (56, 64), 40, "…", cor=CINZA_ESC, cauda=(0.7, 0.8))
    # Versão espelhada (apresentador do lado esquerdo apontando para o conteúdo), com textos legíveis:
    # espelha tudo e recoloca, sem espelhar, o círculo do peito ("IA") e o miolo do balão ("?", "!", "…").
    esp = img.transpose(Image.FLIP_LEFT_RIGHT)
    discos = [(180, 330, 30)] + ([(58, 70, 34)] if extra == "pergunta" else [(58, 64, 32)] if extra in ("alerta", "pensando") else [])
    for (cx, cy, r) in discos:
        caixa = tuple(v * S for v in (cx - r, cy - r, cx + r, cy + r))
        pedaco = img.crop(caixa)
        mascara = Image.new("L", pedaco.size, 0)
        ImageDraw.Draw(mascara).ellipse((0, 0, pedaco.size[0] - 1, pedaco.size[1] - 1), fill=255)
        esp.paste(pedaco, ((W - cx - r) * S, (cy - r) * S), mascara)
    sufixo = 'aberta' if aberta else 'fechada'
    img = img.resize((W, H), Image.LANCZOS)
    esp = esp.resize((W, H), Image.LANCZOS)
    img.save(SAIDA / f"{nome}-{sufixo}.png", optimize=True)
    esp.save(SAIDA / f"{nome}-{sufixo}-esq.png", optimize=True)
    return img


folha = Image.new("RGBA", (W * 8, H * 2), (30, 41, 59, 255))
for i, nome in enumerate(POSES):
    for j, aberta in enumerate((False, True)):
        folha.alpha_composite(desenhar(nome, aberta), (i * W, j * H))
folha.save(SAIDA / "folha.png")

# Embute os desenhos no app (128 cores, PNG com transparência) em src/main/midia/apresentadorArte.ts.
import base64, io
linhas = []
for arq in sorted(SAIDA.glob("*-*.png")):
    q = Image.open(arq).convert("RGBA").quantize(colors=128, method=Image.FASTOCTREE)
    q.save(arq, optimize=True)
    buf = io.BytesIO()
    q.save(buf, format="PNG", optimize=True)
    linhas.append(f"  '{arq.stem}': '{base64.b64encode(buf.getvalue()).decode()}'")
destino = Path(__file__).resolve().parent.parent / "src" / "main" / "midia" / "apresentadorArte.ts"
cabecalho = "// Arquivo GERADO por scripts/apresentador.py (desenho original do apresentador do canal). Não edite à mão."
destino.write_text(cabecalho + "\nexport const ARTE_APRESENTADOR: Record<string, string> = {\n" + ",\n".join(linhas) + "\n}\n", encoding="utf-8")
print("ok", len(linhas), "desenhos")
