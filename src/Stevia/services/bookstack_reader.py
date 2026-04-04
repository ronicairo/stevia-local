import re, os
from datetime import datetime
from langchain_core.documents import Document as LCDocument
from langchain_text_splitters import RecursiveCharacterTextSplitter
from zoneinfo import ZoneInfo

BOOKSTACK_URL = os.getenv("BOOKSTACK_URL")
if not BOOKSTACK_URL:
    raise ValueError("BOOKSTACK_URL non défini dans le .env")

def clean_html(html: str) -> str:
    """Convertit le HTML en texte structuré (préserve titres et listes)."""

    # Remplace les titres par des marqueurs
    html = re.sub(r'<h1[^>]*>(.*?)</h1>', r'\n\n# \1\n\n', html, flags=re.DOTALL)
    html = re.sub(r'<h2[^>]*>(.*?)</h2>', r'\n\n## \1\n\n', html, flags=re.DOTALL)
    html = re.sub(r'<h3[^>]*>(.*?)</h3>', r'\n\n### \1\n\n', html, flags=re.DOTALL)
    html = re.sub(r'<h4[^>]*>(.*?)</h4>', r'\n\n#### \1\n\n', html, flags=re.DOTALL)

    # Préserve les listes numérotées
    html = re.sub(r'<li[^>]*>\s*(\d+\.?\s*)', r'\n\1 ', html)
    html = re.sub(r'<li[^>]*>', r'\n• ', html)

    # Sauts de ligne pour paragraphes (ouverture ET fermeture)
    html = re.sub(r'<p[^>]*>', r'\n\n', html)
    html = re.sub(r'</p>', r'\n', html)
    html = re.sub(r'<br\s*/?>', '\n', html)
    html = re.sub(r'</div>', '\n', html)

    # Supprime span, sup, sub et autres balises inline (garde le contenu)
    html = re.sub(r'</?span[^>]*>', '', html)
    html = re.sub(r'</?sup[^>]*>', '', html)
    html = re.sub(r'</?sub[^>]*>', '', html)

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
        context_before = re.sub(r'<[^>]+>', ' ', context_before)
        context_before = re.sub(r'\s+', ' ', context_before).strip().lower()

        images.append({
            "url": src,
            "context": context_before
        })

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
            "indexed_at": datetime.now(ZoneInfo("Europe/Paris")).isoformat(),
        }
    )

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1200,
        chunk_overlap=100,
        separators=["\n\n", "\n### ", "\n## ", "\n# ", "\n", " "]
    )

    docs = text_splitter.split_documents([doc])

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