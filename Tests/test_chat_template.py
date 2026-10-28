"""Test the formatting adapter without downloading or loading a model."""
from pathlib import Path
import unittest
try:
    from jinja2 import Environment
except ImportError:
    Environment = None

@unittest.skipIf(Environment is None, 'Jinja2 is an optional test dependency')
class ChatTemplateTests(unittest.TestCase):
    def render(self, messages):
        source = (Path(__file__).resolve().parents[1] / 'platform/templates/hunyuan-translation.jinja').read_text()
        return Environment().from_string(source).render(messages=messages)

    def test_single_user(self):
        self.assertEqual(self.render([{'role': 'user', 'content': 'Hello'}]), '<|startoftext|>Hello<|extra_0|>')

    def test_system_then_user_then_answer(self):
        self.assertEqual(self.render([{'role': 'system', 'content': 'Translate'}, {'role': 'user', 'content': 'Hello'}, {'role': 'assistant', 'content': '你好'}]), '<|startoftext|>Translate<|extra_4|>Hello<|extra_0|>你好<|eos|>')

    def test_empty_system_and_followup(self):
        self.assertEqual(self.render([{'role':'system','content':''}, {'role':'user','content':'A'}, {'role':'assistant','content':'甲'}, {'role':'user','content':'B'}]), '<|startoftext|>A<|extra_0|>甲<|eos|><|startoftext|>B<|extra_0|>')
