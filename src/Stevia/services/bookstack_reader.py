import re, os
from datetime import datetime
from langchain_core.documents import Document as LCDocument
from langchain_text_splitters import RecursiveCharacterTextSplitter

BOOKSTACK_URL = os.getenv("BOOKSTACK_URL")
if not BOOKSTACK_URL:
    raise ValueError("BOOKSTACK_URL non défini dans le .env")

# Marques d'une cellule de tableau croisé (X, croix, coche…)
_TABLE_MARK_RE = re.compile(r'^(x|×|✕|✓|✔|✗|oui)$', re.IGNORECASE)


def _cell_to_text(c: str) -> str:
    # Préserve les sauts de paragraphe/br avec un placeholder (⏎) avant de retirer les tags
    c = re.sub(r'</p>\s*<p[^>]*>', '⏎', c, flags=re.IGNORECASE)
    c = re.sub(r'<br\s*/?>', '⏎', c, flags=re.IGNORECASE)
    c = re.sub(r'<li[^>]*>', '⏎- ', c, flags=re.IGNORECASE)
    c = re.sub(r'<[^>]+>', '', c)
    c = re.sub(r'[ \t]+', ' ', c).strip()
    return c


def _table_to_markdown(table_html: str) -> str:
    """Convertit une table HTML en texte.
    - Tableau 'matrice' (lignes de X croisant des colonnes) → remplace chaque X par le NOM
      de sa colonne + une vue par colonne. Sinon un petit modèle ne peut pas lire
      l'alignement des X (ex. « à quoi sert le profil sucre_consult »).
    - Sinon → tableau markdown classique avec headers (comportement d'origine)."""
    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', table_html, re.DOTALL | re.IGNORECASE)
    if not rows:
        return ''

    # --- Détection MATRICE : une ligne d'en-tête (noms de colonnes) + ≥2 lignes de marques ---
    parsed = []
    for row_html in rows:
        cells = re.findall(r'<t[hd][^>]*>(.*?)</t[hd]>', row_html, re.DOTALL | re.IGNORECASE)
        cells = [_cell_to_text(c) for c in cells]
        if any(cells):
            parsed.append(cells)
    if parsed:
        ncol = max(len(r) for r in parsed)

        def _is_mark(v: str) -> bool:
            return _TABLE_MARK_RE.match(v.strip()) is not None

        def _is_mark_row(r: list) -> bool:
            body = r[1:]  # hors 1re colonne (le label de ligne)
            return (len(body) >= 2
                    and all(_is_mark(v) or not v.strip() for v in body)
                    and any(_is_mark(v) for v in body))

        header_row, data_rows = None, []
        for r in parsed:
            if len(r) != ncol:            # ligne colspan (en-tête fusionné) → ignorée
                continue
            if _is_mark_row(r):
                data_rows.append(r)
            elif header_row is None:
                header_row = r            # 1re ligne pleine non-marquée = noms de colonnes

        if header_row and len(data_rows) >= 2:
            cols = header_row[1:]
            axis = header_row[0] or "Élément"
            out = []
            for r in data_rows:           # vue par LIGNE : « Consultation : accessible par … »
                acc = [cols[i] for i, v in enumerate(r[1:]) if i < len(cols) and _is_mark(v)]
                if acc:
                    out.append(f"{axis} « {r[0]} » : accessible par les profils {', '.join(acc)}.")
            for j, col in enumerate(cols):  # vue par COLONNE : « sucre_consult a accès à … »
                feats = [r[0] for r in data_rows if j + 1 < len(r) and _is_mark(r[j + 1])]
                if feats:
                    out.append(f"Le profil {col} a accès à : {', '.join(feats)}.")
            return '\n' + '\n'.join(out) + '\n\n'

    # --- Table normale → markdown classique (comportement d'origine) ---
    result = []
    header_done = False
    for row_html in rows:
        cells_th = re.findall(r'<th[^>]*>(.*?)</th>', row_html, re.DOTALL | re.IGNORECASE)
        cells_td = re.findall(r'<td[^>]*>(.*?)</td>', row_html, re.DOTALL | re.IGNORECASE)
        is_header = bool(cells_th)
        cells = cells_th if cells_th else cells_td
        cleaned = [_cell_to_text(c) for c in cells]
        if not any(cleaned):
            continue
        result.append('| ' + ' | '.join(cleaned) + ' |')
        if is_header and not header_done:
            result.append('| ' + ' | '.join(['---'] * len(cleaned)) + ' |')
            header_done = True

    return '\n' + '\n'.join(result) + '\n\n'



def clean_html(html: str) -> str:
    """Convertit le HTML en texte structuré (préserve titres et listes)."""

    # Capture les ancres BookStack (id="bkmrk-...") : on insère un marqueur juste après
    # la balise ouvrante. Il survit au strip des tags et atterrit en tête du bloc, donc
    # du chunk → permet de lier la source à l'endroit précis de la page.
    html = re.sub(
        r'(<[a-zA-Z][a-zA-Z0-9]*\b[^>]*?\bid=["\'](bkmrk-[^"\']*)["\'][^>]*>)',
        lambda m: m.group(1) + f'⟦ANCHOR:{m.group(2)}⟧',
        html, flags=re.IGNORECASE
    )

    # Tables → markdown structuré avec headers explicites
    html = re.sub(r'<table[^>]*>.*?</table>', lambda m: _table_to_markdown(m.group(0)), html, flags=re.DOTALL | re.IGNORECASE)

    # Remplace les titres par des marqueurs
    html = re.sub(r'<h1[^>]*>(.*?)</h1>', r'\n\n# \1\n\n', html, flags=re.DOTALL)
    html = re.sub(r'<h2[^>]*>(.*?)</h2>', r'\n\n## \1\n\n', html, flags=re.DOTALL)
    html = re.sub(r'<h3[^>]*>(.*?)</h3>', r'\n\n### \1\n\n', html, flags=re.DOTALL)
    html = re.sub(r'<h4[^>]*>(.*?)</h4>', r'\n\n#### \1\n\n', html, flags=re.DOTALL)

    # Préserve le gras en markdown
    html = re.sub(r'<(?:strong|b)[^>]*>(.*?)</(?:strong|b)>', r'**\1**', html, flags=re.IGNORECASE | re.DOTALL)

    # Préserve les listes — fusionne <li><p> pour éviter le • seul sur sa ligne
    html = re.sub(r'<li[^>]*>\s*<p[^>]*>', r'\n• ', html)
    html = re.sub(r'<li[^>]*>\s*(\d+\.?\s*)', r'\n\1 ', html)
    html = re.sub(r'<li[^>]*>', r'\n• ', html)

    def _extract_img_md(img_html: str, inline: bool = False) -> str:
        """Convertit un tag <img> en markdown, en utilisant le vrai alt BookStack.
        Capture la taille d'affichage BookStack (style="width:Xin;height:Yin") et
        l'encode dans l'URL via #sz=WxH (px), pour reproduire la taille du doc."""
        src_m = re.search(r'src=["\']([^"\']+)["\']', img_html, re.IGNORECASE)
        if not src_m:
            return ''
        src = src_m.group(1)
        if src.startswith("data:"):
            return ''
        if src.startswith("/"):
            src = f"{BOOKSTACK_URL}{src}"
        elif not src.startswith("http"):
            src = f"{BOOKSTACK_URL}/{src}"
        # Taille d'affichage BookStack → px (1in = 96px ; px gardé tel quel)
        w_m = re.search(r'width:\s*([\d.]+)(in|px)', img_html, re.IGNORECASE)
        h_m = re.search(r'height:\s*([\d.]+)(in|px)', img_html, re.IGNORECASE)
        if w_m and h_m:
            def _to_px(v, u):
                return round(float(v) * (96 if u.lower() == 'in' else 1))
            w_px, h_px = _to_px(*w_m.groups()), _to_px(*h_m.groups())
            if 0 < w_px <= 4000 and 0 < h_px <= 4000:
                src = f"{src}#sz={w_px}x{h_px}"
        alt_m = re.search(r'alt=["\']([^"\']+)["\']', img_html, re.IGNORECASE)
        alt_raw = alt_m.group(1).strip() if alt_m else ""
        # Ignore les alts qui sont des URLs ou trop courts
        alt = alt_raw if (alt_raw and not alt_raw.startswith("http") and len(alt_raw) > 2) else "image"
        return f"![{alt}]({src})" if inline else f"\n![{alt}]({src})\n"

    # <p> avec image inline (icône + texte dans le même paragraphe)
    # → préserve l'image sur la même ligne que le texte qui suit
    def _handle_p_inline_img(m):
        img_html = m.group(1)
        text_after = m.group(2).strip()
        md = _extract_img_md(img_html, inline=True)
        if not md:
            return f'\n\n{text_after}\n'
        return f'\n\n{md} {text_after}\n'

    html = re.sub(
        r'<p[^>]*>\s*(<img[^>]+>)\s*([^<]{8,})',
        _handle_p_inline_img,
        html, flags=re.IGNORECASE | re.DOTALL
    )

    # Sauts de ligne pour paragraphes (ouverture ET fermeture)
    html = re.sub(r'<p[^>]*>', r'\n\n', html)
    html = re.sub(r'</p>', r'\n', html)
    html = re.sub(r'<br\s*/?>', '\n', html)
    html = re.sub(r'</div>', '\n', html)

    # Supprime les références de notes de bas de page BookStack (lien + contenu)
    html = re.sub(r'<a[^>]+class="footnote-ref"[^>]*>.*?</a>', '', html, flags=re.IGNORECASE | re.DOTALL)
    # Supprime sup/sub avec leur contenu (numéros de notes, exposants)
    html = re.sub(r'<sup[^>]*>.*?</sup>', '', html, flags=re.IGNORECASE | re.DOTALL)
    html = re.sub(r'<sub[^>]*>.*?</sub>', '', html, flags=re.IGNORECASE | re.DOTALL)
    # Supprime span et autres balises inline (garde le contenu)
    html = re.sub(r'</?span[^>]*>', '', html)

    # Images restantes (blocs seuls) → avec le vrai alt BookStack
    def _replace_img(m):
        return _extract_img_md(m.group(0), inline=False) or ' '
    html = re.sub(r'<img[^>]+>', _replace_img, html, flags=re.IGNORECASE)

    # Supprime les autres balises
    text = re.sub(r'<[^>]+>', ' ', html)

    # Nettoie les espaces horizontaux (garde les \n)
    text = re.sub(r'[ \t]+', ' ', text)

    # Nettoie les lignes avec seulement des espaces
    text = re.sub(r'\n +', '\n', text)

    # Max 2 sauts de ligne consécutifs
    text = re.sub(r'\n{3,}', '\n\n', text)

    return text.strip()

def extract_images_with_context(html: str) -> list[dict]:
    """Extrait les images avec le texte qui les PRÉCÈDE (l'image illustre ce texte)."""
    images = []

    img_pattern = re.compile(r'<img[^>]+src=["\']([^"\']+)["\'][^>]*>', re.IGNORECASE)

    for match in img_pattern.finditer(html):
        src = match.group(1)

        if src.startswith("data:"):
            continue

        if src.startswith("/"):
            src = f"{BOOKSTACK_URL}{src}"
        elif not src.startswith("http"):
            src = f"{BOOKSTACK_URL}/{src}"

        start_before = max(0, match.start() - 300)
        context_before = html[start_before:match.start()]
        # Pour les icones inline (image suivie de texte), le contexte pertinent est APRÈS
        context_after = html[match.end():match.end() + 200]

        combined = context_before + " " + context_after
        combined = re.sub(r'<[^>]+>', ' ', combined)
        combined = re.sub(r'\s+', ' ', combined).strip().lower()

        images.append({"url": src, "context": combined})

    return images


def extract_important_words(html: str, page_title: str = "") -> dict:
    """Extrait les mots importants (titres + gras) du HTML."""

    important = {
        "title_words": set(),
        "bold_words": set(),
    }

    if page_title:
        for word in page_title.lower().split():
            if len(word) > 3:
                important["title_words"].add(word)

    # Titres (h1-h4)
    title_patterns = [
        r'<h1[^>]*>(.*?)</h1>',
        r'<h2[^>]*>(.*?)</h2>',
        r'<h3[^>]*>(.*?)</h3>',
        r'<h4[^>]*>(.*?)</h4>',
    ]

    for pattern in title_patterns:
        matches = re.findall(pattern, html, flags=re.IGNORECASE | re.DOTALL)
        for match in matches:
            clean_text = re.sub(r'<[^>]+>', '', match).strip().lower()
            for word in clean_text.split():
                if len(word) > 3:
                    important["title_words"].add(word)

    # Gras
    bold_patterns = [
        r'<strong[^>]*>(.*?)</strong>',
        r'<b[^>]*>(.*?)</b>',
    ]

    for pattern in bold_patterns:
        matches = re.findall(pattern, html, flags=re.IGNORECASE | re.DOTALL)
        for match in matches:
            clean_text = re.sub(r'<[^>]+>', '', match).strip().lower()
            for word in clean_text.split():
                if len(word) > 3:
                    important["bold_words"].add(word)

    return important


def extract_roles_from_tags(tags: list) -> list:
    """Extrait les rôles des tags BookStack."""
    roles = []
    for tag in tags:
        tag_name = tag.get("name", "").lower()
        tag_value = tag.get("value", "").lower()

        if tag_name == "role" and tag_value:
            roles.append(tag_value)

    # Si pas de tag role → accessible à tous
    if not roles:
        roles = ["all"]

    return roles


def _is_bullet_line(s: str) -> bool:
    s = s.strip()
    return s == "•" or s.startswith(("• ", "- ", "* "))


def _merge_bullet_chunks(docs: list[LCDocument], max_merged: int = 3000) -> list[LCDocument]:
    """Fusionne les chunks qui COUPENT une liste de puces, pour ne jamais scinder une
    liste entre deux chunks. Une liste chevauche la frontière si le chunk courant FINIT
    par une puce OU si le chunk suivant COMMENCE par une puce. Fusionne en boucle
    (liste sur 3+ chunks), avec un plafond de taille pour éviter un chunk géant."""
    if len(docs) <= 1:
        return docs

    merged: list[LCDocument] = []
    i = 0
    while i < len(docs):
        content = docs[i].page_content
        j = i + 1
        while j < len(docs) and len(content) < max_merged:
            cur_lines = [l for l in content.splitlines() if l.strip()]
            nxt_lines = [l for l in docs[j].page_content.splitlines() if l.strip()]
            cur_last = cur_lines[-1] if cur_lines else ""
            nxt_first = nxt_lines[0] if nxt_lines else ""
            # liste à cheval sur la frontière → on absorbe le chunk suivant
            if _is_bullet_line(cur_last) or _is_bullet_line(nxt_first):
                content = content.rstrip() + "\n" + docs[j].page_content.lstrip()
                j += 1
            else:
                break
        merged.append(LCDocument(page_content=content, metadata=docs[i].metadata))
        i = j if j > i + 1 else i + 1

    return merged


def _is_title_only(content: str) -> bool:
    """True si le chunk ne contient que des titres ([TITRE] ou titres markdown #..),
    sans corps de texte exploitable (< 30 car. hors titres/images/ancres).
    Un titre seul n'apporte jamais de réponse."""
    body = re.sub(r'⟦ANCHOR:bkmrk-[^⟧]*⟧', '', content)
    body = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', body)
    lines = [l.strip() for l in body.splitlines() if l.strip()]
    if not lines:
        return True

    def _is_heading(l: str) -> bool:
        return l.startswith('[TITRE]') or bool(re.match(r'#{1,6}\s', l))

    non_heading = ' '.join(l for l in lines if not _is_heading(l))
    return len(non_heading.strip()) < 30


def _merge_title_only_chunks(docs: list[LCDocument]) -> list[LCDocument]:
    """Fusionne les chunks réduits à un titre dans le chunk suivant (le titre sert
    alors d'en-tête de contexte au corps qui le suit). Un titre orphelin en fin de
    page est rattaché au chunk précédent."""
    if len(docs) <= 1:
        return docs

    out: list[LCDocument] = []
    carry = ""  # titre(s) en attente d'être collés au prochain chunk avec du contenu
    for doc in docs:
        if _is_title_only(doc.page_content):
            carry = (carry + "\n\n" + doc.page_content).strip() if carry else doc.page_content
            continue
        if carry:
            doc = LCDocument(page_content=carry + "\n\n" + doc.page_content, metadata=doc.metadata)
            carry = ""
        out.append(doc)

    if carry:
        if out:
            last = out[-1]
            out[-1] = LCDocument(page_content=last.page_content + "\n\n" + carry, metadata=last.metadata)
        else:
            out.append(LCDocument(page_content=carry, metadata=docs[-1].metadata))
    return out


def parse_bookstack_page(page: dict, book_name: str = None, book_slug: str = None, book_tags: list = None) -> list[LCDocument]:
    """Parse une page BookStack et retourne une liste de documents LangChain."""

    page_id = page.get("id")
    title = page.get("name", "Sans titre")
    html_content = page.get("html", "")
    book_id = page.get("book_id")
    chapter_id = page.get("chapter_id")
    slug = page.get("slug")
    page_tags = page.get("tags", [])

    page_roles = extract_roles_from_tags(page_tags)
    book_roles = extract_roles_from_tags(book_tags or [])

    if page_roles and page_roles != ["all"]:
        roles = page_roles
    elif book_roles and book_roles != ["all"]:
        roles = book_roles
    else:
        roles = ["all"]

    important = extract_important_words(html_content, page_title=title)
    images_with_context = extract_images_with_context(html_content)

    text = clean_html(html_content)

    if not text:
        return []

    doc = LCDocument(
        page_content=f"[TITRE] {title}\n\n{text}",
        metadata={
            "source": "bookstack",
            "page_id": str(page_id) if page_id else None,
            "book_id": str(book_id) if book_id else None,
            "book_name": book_name,
            "chapter_id": str(chapter_id) if chapter_id else None,
            "title": title,
            "title_words": ",".join(important["title_words"]),
            "bold_words": ",".join(important["bold_words"]),
            "slug": slug,
            "book_slug": book_slug,
            "roles": ",".join(roles),
            "indexed_at": datetime.now().astimezone().isoformat(),  # heure locale du serveur (tz-aware)
        }
    )

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=800,
        chunk_overlap=80,
        separators=["\n# ", "\n## ", "\n### ", "\n#### ", "\n\n", "\n• ", "\n", " "]
    )

    docs = text_splitter.split_documents([doc])
    docs = _merge_bullet_chunks(docs)
    docs = _merge_title_only_chunks(docs)

    carry_anchor = ""  # dernière ancre vue : la section peut avoir commencé dans un chunk précédent
    for idx, chunk_doc in enumerate(docs):
        chunk_doc.metadata["chunk_index"] = idx
        # Capture TOUTES les ancres ⟦ANCHOR:bkmrk-...⟧ avec leur position dans le
        # contenu nettoyé (un chunk peut couvrir plusieurs sections). On garde la 1ère
        # comme ancre par défaut + la liste "offset:id|..." pour viser la bonne section
        # au moment de la requête (cf. _pick_anchor côté rag_engine).
        content = chunk_doc.page_content
        anchors: list[tuple[int, str]] = []
        clean_parts: list[str] = []
        last = 0
        running = 0
        for m in re.finditer(r'⟦ANCHOR:(bkmrk-[^⟧]*)⟧', content):
            seg = content[last:m.start()]
            clean_parts.append(seg)
            running += len(seg)
            anchors.append((running, m.group(1)))
            last = m.end()
        clean_parts.append(content[last:])
        chunk_doc.page_content = "".join(clean_parts)

        # Ancre de section héritée à l'offset 0 : le début du chunk appartient à la
        # section du chunk précédent tant qu'aucune nouvelle ancre n'apparaît.
        full_anchors: list[tuple[int, str]] = []
        if carry_anchor and (not anchors or anchors[0][0] > 0):
            full_anchors.append((0, carry_anchor))
        full_anchors.extend(anchors)
        if anchors:
            carry_anchor = anchors[-1][1]

        chunk_doc.metadata["anchor"] = full_anchors[0][1] if full_anchors else ""
        chunk_doc.metadata["anchors"] = "|".join(f"{off}:{aid}" for off, aid in full_anchors)

    for chunk_doc in docs:
        chunk_text = chunk_doc.page_content.lower()
        chunk_images = []

        for img in images_with_context:
            context = img["context"]
            if not context:
                continue

            context_words = [w for w in context.split() if len(w) > 5]
            if len(context_words) < 3:
                continue

            matches = sum(1 for word in context_words if word in chunk_text)
            match_ratio = matches / len(context_words)

            if match_ratio > 0.6:
                chunk_images.append(img["url"])

        chunk_doc.metadata["images"] = chunk_images[0] if chunk_images else ""

    return docs