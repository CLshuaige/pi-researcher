"""Check glyph coverage before any artists are created, then draw with CJK."""

import importlib.util
from pathlib import Path
import tempfile
import unittest
import warnings

spec = importlib.util.spec_from_file_location("review_plotting", Path(__file__).resolve().parents[1] / "scripts/plotting.py")
plotting = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plotting)

try:
    import matplotlib
    matplotlib.use("Agg")
    from matplotlib import font_manager
    import matplotlib.pyplot as plt
except ImportError:
    matplotlib = None


@unittest.skipIf(matplotlib is None, "Matplotlib is optional unless drawing figures")
class PlottingTests(unittest.TestCase):
    def test_missing_glyphs_fail_before_plot_creation(self):
        latin = font_manager.findfont(font_manager.FontProperties(family="DejaVu Sans"))
        with self.assertRaisesRegex(ValueError, "No font covers"):
            plotting.configure_chinese_font("中文证据图", latin)

    def test_discovered_cjk_font_draws_labels_without_missing_glyph_warnings(self):
        labels = ["检索证据", "方法比较", "综述综合"]
        with matplotlib.rc_context():
            font = plotting.configure_chinese_font(labels)
            self.assertTrue(Path(font.get_file()).is_file())
            with tempfile.TemporaryDirectory() as folder, warnings.catch_warnings():
                warnings.filterwarnings("error", message="Glyph .*missing from font")
                fig, ax = plt.subplots()
                try:
                    ax.set_title(labels[0], fontproperties=font)
                    ax.set_xlabel(labels[1])  # Check process-local defaults too.
                    ax.text(0.5, 0.5, labels[2], fontproperties=font)
                    output = Path(folder) / "chinese.png"
                    fig.savefig(output)
                    self.assertGreater(output.stat().st_size, 100)
                finally:
                    plt.close(fig)


if __name__ == "__main__":
    unittest.main()
