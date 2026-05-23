#!/usr/bin/env python3
"""주제당 4컷 1세트 — STAR 흐름 + 한글 키워드"""
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "content", "comics", "topic-00")
W, H = 200, 150


def esc(s):
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def svg_file(name, label, step_tag, draw_body):
    body = draw_body()
    content = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" role="img" aria-label="{esc(label)}">
  <rect width="{W}" height="{H}" fill="#F8FAFC" rx="10"/>
  <rect x="8" y="8" width="52" height="22" rx="11" fill="#E0E7FF"/>
  <text x="34" y="23" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="800" fill="#4338CA">{esc(step_tag)}</text>
  <rect x="0" y="108" width="{W}" height="42" fill="#FFFFFF"/>
  <line x1="0" y1="108" x2="{W}" y2="108" stroke="#E2E8F0" stroke-width="1"/>
  {body}
  <text x="{W//2}" y="132" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="13" font-weight="700" fill="#1E293B">{esc(label)}</text>
</svg>'''
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def person(x, y, color="#6366F1"):
    return f'''
  <circle cx="{x}" cy="{y}" r="14" fill="{color}"/>
  <rect x="{x-12}" y="{y+12}" width="24" height="28" rx="6" fill="{color}"/>'''


def monitor(x, y, w, h, title, accent="#6366F1"):
    return f'''
  <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="#E2E8F0" stroke="#94A3B8" stroke-width="2"/>
  <rect x="{x+8}" y="{y+8}" width="{w-16}" height="{h-22}" rx="4" fill="#FFFFFF"/>
  <text x="{x+w//2}" y="{y+24}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="800" fill="{accent}">{esc(title)}</text>'''


def arrow(x1, y1, x2, y2):
    return f'''
  <line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#6366F1" stroke-width="4" stroke-linecap="round"/>
  <polygon points="{x2},{y2} {x2-10},{y2-5} {x2-10},{y2+5}" fill="#6366F1"/>'''


def badge(x, y, text, bg="#FEF3C7", fg="#92400E"):
    tw = max(44, len(text) * 13 + 14)
    return f'''
  <rect x="{x}" y="{y}" width="{tw}" height="24" rx="12" fill="{bg}"/>
  <text x="{x + tw//2}" y="{y+17}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="800" fill="{fg}">{esc(text)}</text>'''


def main():
    os.makedirs(OUT, exist_ok=True)
    panels = [
        (
            "panel-1.svg",
            "NPS 후 운영팀 합류",
            "1 상황",
            lambda: monitor(25, 38, 95, 62, "NPS") + person(145, 48, "#059669") + badge(118, 32, "운영"),
        ),
        (
            "panel-2.svg",
            "ETL 로그 이중 확인",
            "2 문제",
            lambda: monitor(18, 36, 72, 58, "ETL") + monitor(110, 36, 72, 58, "LOG") + badge(62, 88, "2번 확인", "#FEE2E2", "#B91C1C"),
        ),
        (
            "panel-3.svg",
            "퇴근 후 스크립트·UI",
            "3 행동",
            lambda: f'<text x="28" y="58" font-size="28">🌙</text>' + monitor(55, 34, 68, 58, "shell") + monitor(128, 30, 62, 68, "UI", "#059669") + badge(88, 88, "로그화면"),
        ),
        (
            "panel-4.svg",
            "이중 접속 제거·절약",
            "4 결과",
            lambda: monitor(35, 38, 90, 58, "ONE UI", "#059669")
            + f'<text x="100" y="78" font-size="24" fill="#059669">✓</text>'
            + f'<circle cx="150" cy="58" r="26" fill="#ECFDF5" stroke="#059669" stroke-width="3"/>'
            + f'<text x="150" y="66" text-anchor="middle" font-size="14" font-weight="800" fill="#047857">시간↓</text>',
        ),
    ]
    for name, label, step, draw in panels:
        svg_file(name, label, step, draw)
    print(f"Wrote {len(panels)} topic panels to {OUT}")


if __name__ == "__main__":
    main()
