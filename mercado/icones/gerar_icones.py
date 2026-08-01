#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Icones do app "No mercado com a Nutri Ana" (PWA instalavel).

Monograma REAL da marca em branco sobre o bordo Pantone 235 C, mesma
receita dos icones do portal da Plataforma -- assim o icone do app novo
senta ao lado do outro na tela inicial e os dois sao visivelmente da
mesma nutricionista.

O maskable tem folga maior: Android recorta o icone em circulo, losango
ou squircle conforme o aparelho, e sem margem o monograma perde as pontas.

Uso: python gerar_icones.py   (roda de dentro de site/mercado/icones/)
"""
import os
from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
MONO = os.path.join(AQUI, "..", "..", "assets", "img", "monograma.png")
BORDO = (132, 11, 85, 255)      # #840B55 -- Pantone 235 C


def gerar(lado, nome, ocupacao):
    """ocupacao: fracao do lado que o monograma ocupa (o resto e respiro)."""
    fundo = Image.new("RGBA", (lado, lado), BORDO)

    mono = Image.open(MONO).convert("RGBA")
    alvo = int(lado * ocupacao)
    r = min(alvo / mono.width, alvo / mono.height)
    mono = mono.resize((max(1, int(mono.width * r)), max(1, int(mono.height * r))), Image.LANCZOS)

    # O monograma vem em bordo sobre transparente. Pinta de branco
    # preservando o canal alfa -- sem isso ele sumiria no fundo.
    branco = Image.new("RGBA", mono.size, (255, 255, 255, 255))
    branco.putalpha(mono.getchannel("A"))

    fundo.paste(branco, ((lado - mono.width) // 2, (lado - mono.height) // 2), branco)
    saida = os.path.join(AQUI, nome)
    fundo.save(saida, "PNG")
    print("%-28s %dx%d" % (nome, lado, lado))


if __name__ == "__main__":
    gerar(192, "icon-192.png", 0.62)
    gerar(512, "icon-512.png", 0.62)
    gerar(512, "icon-maskable-512.png", 0.44)   # folga para o recorte do Android
    print("pronto")
