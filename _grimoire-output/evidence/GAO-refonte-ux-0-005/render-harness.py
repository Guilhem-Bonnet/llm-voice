import json,sys,re,subprocess,os
root="/mnt/Travail/Projets/Dev/TTS-Voice/vscode-extension"
out=sys.argv[1]
css=open(root+"/media/voiceGallery/voiceGallery.css",encoding="utf8").read()
js=open(root+"/media/voiceGallery/voiceGallery.js",encoding="utf8").read()
dark={"foreground":"#cccccc","editor-background":"#1e1e1e","descriptionForeground":"#a8a8a8","sideBar-background":"#252526","panel-border":"#3c3c3c","input-foreground":"#cccccc","input-background":"#3c3c3c","input-border":"#3c3c3c","input-placeholderForeground":"#a8a8a8","focusBorder":"#007fd4","button-secondaryForeground":"#cccccc","button-secondaryBackground":"#3a3d41","button-secondaryHoverBackground":"#45494e","button-foreground":"#ffffff","button-background":"#0e639c","button-hoverBackground":"#1177bb","inputValidation-warningBackground":"#3a2d0f","inputValidation-warningBorder":"#5c4a14","testing-iconPassed":"#89d185","progressBar-background":"#007fd4"}
light=dict(dark); light.update({"foreground":"#3b3b3b","editor-background":"#ffffff","descriptionForeground":"#6a6a6a","sideBar-background":"#f3f3f3","panel-border":"#d4d4d4","input-foreground":"#3b3b3b","input-background":"#ffffff","input-border":"#cecece","input-placeholderForeground":"#767676","button-secondaryForeground":"#3b3b3b","button-secondaryBackground":"#e5e5e5","button-secondaryHoverBackground":"#d4d4d4","inputValidation-warningBackground":"#fff4ce","inputValidation-warningBorder":"#c9a400","testing-iconPassed":"#388a34"})
html_shell=subprocess.check_output(["node","-e","""
const ts=require(process.argv[1]+'/node_modules/typescript');const fs=require('fs');
const src=fs.readFileSync(process.argv[1]+'/src/views/voiceGallery/voiceGalleryHtml.ts','utf8');
const m={exports:{}};new Function('module','exports',ts.transpile(src,{module:'commonjs',target:'es2020'}))(m,m.exports);
console.log(m.exports.buildVoiceGalleryHtml({nonce:'n',cspSource:'x',scriptUri:'SCRIPT',styleUri:'STYLE'}));
""",root],text=True)
body=re.search(r"<body>(.*)</body>",html_shell,re.S).group(1)
body=re.sub(r"<script.*?</script>","",body,flags=re.S)
names="Estelle,Alba,Anna,Azelma,Bill Boerst,Caro Davy,Charles,Éponine,Eve,Fantine,George,Jane,Javert,Marius,Mary,Michael,Paul,Peter Yearsley,Stuart Bell,Vera".split(",")
ids=[n.lower().replace(" ","_").replace("é","e") for n in names]
def cards(started):
    c=[dict(id="system",label="Voix système",section="local",ready=True,canChoose=True,canListen=True,state="Prête",detail="Déjà sur votre machine, qualité correcte."),
       dict(id="piper",label="Piper Siwis",section="local",ready=True,canChoose=True,canListen=True,state="Installée",detail="Voix française autonome, bonne qualité."),
       dict(id="kokoro",label="Kokoro Siwis",section="local",ready=False,canChoose=True,canListen=True,state="Arrêtée",detail="Voix locale rapide. Serveur à démarrer.")]
    for i,n in zip(ids,names): c.append(dict(id=i,label=n,section="kyutai",ready=started,canChoose=True,canListen=True,sampleUri="none.ogg",engine="kyutai"))
    c+= [dict(id="chatterbox",label="Chatterbox",section="prepare",ready=False,canChoose=False,canListen=False,prepare="chatterbox",prepareLabel="Préparer",detail="Qualité maximale. Nécessite Docker."),
         dict(id="own-voice",label="Ma voix",section="prepare",ready=False,canChoose=False,canListen=False,prepare="ownVoice",prepareLabel="Préparer",detail="Clonez votre voix, le fichier reste sur votre machine.")]
    return c
credits=dict(subtitle="D'où viennent les voix de Kyutai Pocket TTS, et sous quelle licence.",groups=[dict(source="VCTK",licence="CC BY 4.0, modifié",voices="Anna, Azelma, Charles, Éponine, Eve, Fantine, George, Jane, Mary, Michael, Paul, Vera",note="Enregistrements retravaillés par Kyutai."),dict(source="Moteur",licence="Modèle CC BY 4.0, code MIT",voices="Kyutai Pocket TTS")],clause="Il est interdit de cloner ou d'imiter une voix sans consentement explicite et légal, et de présenter un contenu généré comme un enregistrement authentique de personnes réelles.",links=[dict(label=l,url="x") for l in ["Voir les licences","Source des voix","Modèle","Code","VCTK","Dons de voix","Voice Zero"]])
measure="""
window.addEventListener('load',()=>setTimeout(()=>{
 const bad=[];let n=0;
 for(const b of document.querySelectorAll('button')){ if(b.offsetParent===null) continue; n++;
  const r=b.getBoundingClientRect(); const lh=parseFloat(getComputedStyle(b).height);
  const range=document.createRange();range.selectNodeContents(b);const rects=[...range.getClientRects()];
  const lines=new Set(rects.map(x=>Math.round(x.top))).size;
  const text=range.getBoundingClientRect().width; const pad=20;
  if(!b.classList.contains('star')){ if(lines>1) bad.push('2lignes:'+b.textContent); if(Math.abs(r.width-(text+pad))>2) bad.push('etire:'+b.textContent+':'+r.width+'/'+text); if(Math.abs(r.height-26)>1) bad.push('hauteur:'+b.textContent+':'+r.height);}
  if(r.right>document.documentElement.clientWidth+1) bad.push('deborde:'+b.textContent);
 }
 const o=document.documentElement.scrollWidth>document.documentElement.clientWidth;
 const p=document.createElement('pre');p.id='result';p.textContent='RESULT w='+innerWidth+' buttons='+n+' overflowX='+o+' bad='+JSON.stringify(bad);document.body.appendChild(p);
 if(!MEASURE_VISIBLE)p.hidden=true;
},100));
"""
def page(theme,started,extra,name):
    vars_=";".join(f"--vscode-{k}:{v}" for k,v in theme.items())
    state=dict(type="state",cards=cards(started),activeId="estelle",activeLabel="Estelle",favorites=["alba"],engines=dict(kyutai=dict(status="started" if started else "stopped",command="pocket-tts serve --language french"),kokoro=dict(status="stopped",command="docker"),chatterbox=dict(status="stopped",command="docker")),credits=credits)
    h=f"""<!DOCTYPE html><html lang=fr><head><meta charset=utf-8><style>:root{{{vars_};--vscode-font-family:system-ui,sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:monospace}}</style><style>{css}</style></head><body>{body}
<script>window.acquireVsCodeApi=()=>({{postMessage(){{}}}});const MEASURE_VISIBLE=false;</script><script>{js}</script><script>window.postMessage({json.dumps(state)},'*');{measure}{extra}</script></body></html>"""
    open(f"{out}/{name}.html","w",encoding="utf8").write(h)
page(dark,True,"","dark-started")
page(dark,False,"","dark-stopped")
page(light,True,"","light-started")
page(dark,True,"setTimeout(()=>document.getElementById('open-credits').click(),60);","dark-credits")
