from app.search.service import safe_headline


def test_headlines_escape_html_but_keep_the_match_markers() -> None:
    raw = '<script>alert(1)</script> fix \x01login\x02 & "logout"'
    assert safe_headline(raw) == (
        "&lt;script&gt;alert(1)&lt;/script&gt; fix <mark>login</mark> &amp; &quot;logout&quot;"
    )
