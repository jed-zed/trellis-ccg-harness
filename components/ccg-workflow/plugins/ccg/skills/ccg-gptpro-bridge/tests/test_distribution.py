"""The plugin and CLI distribution must ship the same runnable helper set."""
from pathlib import Path
import unittest
import ast


class DistributionTests(unittest.TestCase):
    def test_plugin_and_cli_ship_common_budget_helpers(self):
        skill = Path(__file__).resolve().parents[1]
        root = skill.parents[3]
        engine = root / "templates/engine/tools/gptpro"
        for name in ("gptpro_budget.py", "gptpro_mcpx.py", "thinking-modes.json"):
            with self.subTest(name=name):
                self.assertEqual((skill / "scripts" / name).read_bytes(), (engine / name).read_bytes())

        for source in (skill / "scripts/gptpro_bridge.py", engine / "gptpro_bridge.py"):
            tree = ast.parse(source.read_text(encoding="utf-8-sig"))
            functions = {node.name for node in tree.body if isinstance(node, ast.FunctionDef)}
            self.assertTrue({"canonical_thinking_mode", "validate_thinking_mode_evidence"}.issubset(functions))


if __name__ == "__main__":
    unittest.main()
