"""Vérification statique des artboards : texte hors balisage et règle des boutons."""
import re, glob, sys, json
from html.parser import HTMLParser
VOID={'meta','br','img','input','hr','link','source','col','area','base','wbr','embed','param','track','rect','path','circle'}
class P(HTMLParser):
    def __init__(s):
        super().__init__(); s.stack=[]; s.errs=[]; s.xdc_children=[]; s.after_root_text=[]
    def handle_starttag(s,tag,a):
        if s.stack and s.stack[-1]=='x-dc': s.xdc_children.append(tag)
        if tag not in VOID: s.stack.append(tag)
    def handle_startendtag(s,tag,a):
        if s.stack and s.stack[-1]=='x-dc': s.xdc_children.append(tag)
    def handle_endtag(s,tag):
        if tag in VOID: return
        if not s.stack or s.stack[-1]!=tag: s.errs.append(f'balise non appariée </{tag}> (pile {s.stack[-3:]})'); 
        if tag in s.stack:
            while s.stack and s.stack.pop()!=tag: pass
    def handle_data(s,d):
        if d.strip() and s.stack and s.stack[-1] in ('x-dc','body','html'):
            s.after_root_text.append(d.strip()[:60])
def style_of(tag): 
    m=re.search(r'style="([^"]*)"',tag); return m.group(1) if m else ''
def px(s,prop):
    m=re.search(r'(?<![-\w])'+prop+r': (\d+)px',s); return int(m.group(1)) if m else None
def label_width(inner,fs):
    txt=re.sub(r'<[^>]+>','',inner).strip()
    w=len(txt)*0.58*fs
    if '<svg' in inner: w+=14+6
    return txt,w
fails=[]; report={}
for f in sorted(glob.glob('*.dc.html')):
    t=open(f).read(); p=P(); p.feed(t)
    kids=[k for k in p.xdc_children if k!='helmet']
    if len(kids)!=1: fails.append(f'{f}: {len(kids)} éléments racine dans <x-dc> ({kids})')
    if p.after_root_text: fails.append(f'{f}: texte hors balisage {p.after_root_text[:2]}')
    fails+= [f'{f}: {e}' for e in p.errs]
    for m in re.finditer(r'<div style="width: \d+px; height: \d+px">\s*(<dc-import\b[^>]*></dc-import>)(.*?)</div>\s*</x-dc>',t,re.S):
        if m.group(2).strip(): fails.append(f'{f}: contenu parasite après <dc-import> : {re.sub(r"<[^>]+>"," ",m.group(2)).strip()[:60]}')
    n=0
    for m in re.finditer(r'(<button\b[^>]*>)(.*?)</button>',t,re.S):
        n+=1; s=style_of(m.group(1)); inner=m.group(2)
        name=re.sub(r'<[^>]+>','',inner).strip()[:30] or re.search(r'aria-label="([^"]*)"',m.group(1)).group(1)
        if 'flex: none' not in s: fails.append(f'{f}: « {name} » sans flex: none')
        if 'white-space: nowrap' not in s: fails.append(f'{f}: « {name} » sans nowrap')
        if re.search(r'flex-grow: [1-9]|width: 100%',s): fails.append(f'{f}: « {name} » étiré')
        w=px(s,'width'); h=px(s,'height') or px(s,'min-height')
        if w is not None and w<24: fails.append(f'{f}: « {name} » largeur {w} < 24')
        if h is not None and h<24: fails.append(f'{f}: « {name} » hauteur {h} < 24')
        if w is None and '{{vw}}' not in s:
            pm=re.search(r'padding: ([^;]+)',s); v=[int(x[:-2]) if x.endswith('px') else 0 for x in pm.group(1).split()] if pm else [0]
            top=v[0]; bot=v[2] if len(v)>2 else v[0]
            if min(top,bot)<6: fails.append(f'{f}: « {name} » padding vertical {top}/{bot} < 6')
    report[f]=n
# largeur : boutons texte de Main aux trois largeurs
import os
t=open('Main.dc.html').read() if os.path.exists('Main.dc.html') else ''; fit=[]
for vw in (260,320,500):
    avail=vw-40
    for m in re.finditer(r'(<button\b[^>]*>)(.*?)</button>',t,re.S):
        s=style_of(m.group(1))
        if px(s,'width') is not None or '{{vw}}' in s: continue
        fs=px(s,'font-size') or 13
        pm=re.search(r'padding: ([^;]+)',s).group(1).split()
        hp=int(pm[1][:-2])+int((pm[3] if len(pm)==4 else pm[1])[:-2])
        txt,lw=label_width(m.group(2),fs); tot=lw+hp
        if tot>avail: fails.append(f'Main @{vw}px: « {txt} » ≈{tot:.0f}px > {avail}px disponibles')
        fit.append((vw,txt,round(tot)))
# groupes de plusieurs boutons texte : doivent pouvoir passer à la ligne
for f in glob.glob('*.dc.html'):
    t=open(f).read()
    for m in re.finditer(r'<div style="([^"]*display: flex[^"]*)">((?:\s*<button\b(?:(?!aria-label)[^>])*>.*?</button>){2,})',t,re.S):
        if 'flex-wrap: wrap' not in m.group(1) and 'flex-direction: column' not in m.group(1):
            fails.append(f'{f}: groupe de boutons texte sans flex-wrap')
print(json.dumps({'boutons_par_artboard':report,'mesures_Main':fit},ensure_ascii=False))
print('ÉCHECS :' if fails else 'AUCUN ÉCHEC'); [print(' -',x) for x in fails]
sys.exit(1 if fails else 0)
