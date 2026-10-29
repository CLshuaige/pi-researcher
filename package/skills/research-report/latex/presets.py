"""ICML layout adapted from temp/latex/presets.py; defaults to Chinese drafts."""

from dataclasses import dataclass
from enum import Enum
from pathlib import Path


class Journal(str, Enum):
    ICML2026 = "ICML2026"


@dataclass(frozen=True)
class LatexPreset:
    article: str = "article"
    bibliographystyle: str = "icml2026"
    files: tuple[str, ...] = (
        "icml2026.sty", "icml2026.bst", "fancyhdr.sty",
        "algorithm.sty", "algorithmic.sty",
    )

    @property
    def template_dir(self) -> Path:
        return Path(__file__).resolve().parent / "icml2026"

    def packages(self, language: str = "zh", style: str = "preprint") -> str:
        if language not in {"zh", "en"}:
            raise ValueError("language must be zh or en")
        if style not in {"preprint", "anonymous", "accepted"}:
            raise ValueError("style must be preprint, anonymous or accepted")
        chinese = (
            "\\usepackage[UTF8,scheme=plain,heading=false,fontset=fandol]{ctex}\n"
            if language == "zh" else ""
        )
        option = f"[{style}]" if style != "anonymous" else ""
        packages = (
            chinese
            + "\\usepackage{amsmath,amssymb,amsthm,graphicx,booktabs}\n"
            + "\\usepackage{hyperref}\n"
            + f"\\usepackage{option}{{icml2026}}\n"
        )
        if language == "zh":
            packages += (
                "% ICML loads legacy times; select its OpenType equivalents for TU encoding.\n"
                "\\setmainfont{texgyretermes}[Extension=.otf,UprightFont=*-regular,"
                "BoldFont=*-bold,ItalicFont=*-italic,BoldItalicFont=*-bolditalic]\n"
                "\\setsansfont{texgyreheros}[Extension=.otf,UprightFont=*-regular,"
                "BoldFont=*-bold,ItalicFont=*-italic,BoldItalicFont=*-bolditalic]\n"
                "\\setmonofont{texgyrecursor}[Extension=.otf,UprightFont=*-regular,"
                "BoldFont=*-bold,ItalicFont=*-italic,BoldItalicFont=*-bolditalic]\n"
                "\\renewcommand{\\refname}{参考文献}\n"
                "\\renewcommand{\\figurename}{图}\n"
                "\\renewcommand{\\tablename}{表}\n"
                "% ICML hard-codes Figure/Table in these label macros.\n"
                "\\makeatletter\n"
                "\\renewcommand{\\fnum@figure}{\\figurename~\\thefigure}\n"
                "\\renewcommand{\\fnum@table}{\\tablename~\\thetable}\n"
                "\\makeatother\n"
                "\\floatname{algorithm}{算法}\n"
                "% Keep the template's abstract spacing and two-column layout.\n"
                "\\renewenvironment{abstract}{%\n"
                "  \\centerline{\\large\\bfseries 摘要}%\n"
                "  \\vspace{-0.12in}\\begin{quote}%\n"
                "}{\\par\\end{quote}\\vskip 0.12in}\n"
            )
        return packages


icml2026_preset = LatexPreset()
journal_presets = {Journal.ICML2026: icml2026_preset}


def get_preset(journal: Journal = Journal.ICML2026) -> LatexPreset:
    # Invalid formats should fail rather than silently select a different layout.
    return journal_presets[Journal(journal)]
