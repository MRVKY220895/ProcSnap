import json
import re
from typing import List, Dict, Any, Optional

def sanitize_var_name(name: str) -> str:
    clean = re.sub(r'[^a-zA-Z0-9_]', '_', (name or '').lower())
    clean = re.sub(r'_+', '_', clean).strip('_')
    return clean or 'param_value'

class ProcBotGenerator:
    def __init__(self, workflow_name: str, steps: List[Dict[str, Any]], variables: Optional[Dict[str, str]] = None):
        self.workflow_name = workflow_name or 'ProcBot Workflow'
        self.steps = steps or []
        self.variables = variables or {}

    def _extract_selector(self, step: Dict[str, Any]) -> Dict[str, str]:
        raw_el = step.get('element') or {}
        if isinstance(raw_el, str):
            try:
                raw_el = json.loads(raw_el)
            except Exception:
                raw_el = {}
        
        el_id = raw_el.get('id')
        name = raw_el.get('name')
        css = raw_el.get('cssSelector') or raw_el.get('selector')
        xpath = raw_el.get('xpath')
        text = raw_el.get('text') or raw_el.get('ariaLabel') or raw_el.get('placeholder')
        rect = raw_el.get('rect') or {}

        if el_id and not el_id.startswith('ember') and not re.match(r'^[0-9a-f]{8}-', el_id):
            return {'strategy': 'id', 'selector': f'#{el_id}', 'playwright': f'#{el_id}', 'selenium': f'By.ID, "{el_id}"'}
        if name:
            return {'strategy': 'name', 'selector': f'[name="{name}"]', 'playwright': f'[name="{name}"]', 'selenium': f'By.NAME, "{name}"'}
        if css and len(css) < 100:
            return {'strategy': 'css', 'selector': css, 'playwright': css, 'selenium': f'By.CSS_SELECTOR, "{css}"'}
        if xpath:
            return {'strategy': 'xpath', 'selector': xpath, 'playwright': f'xpath={xpath}', 'selenium': f'By.XPATH, "{xpath}"'}
        if text:
            clean_text = text.strip()[:40].replace('"', '')
            return {'strategy': 'text', 'selector': f'text={clean_text}', 'playwright': f'text={clean_text}', 'selenium': f'By.XPATH, "//*[contains(text(), \'{clean_text}\')]"'}
        return {'strategy': 'coord', 'selector': f'coord({rect.get("x", 0)}, {rect.get("y", 0)})', 'playwright': '', 'selenium': ''}

    def generate_playwright_script(self) -> str:
        script_lines = [
            '# ProcBot RPA Automation Script (Playwright)',
            f'# Workflow: {self.workflow_name}',
            '# Run: pip install playwright && playwright install chromium',
            '',
            'import time',
            'import sys',
            'from playwright.sync_api import sync_playwright',
            '',
            'VARIABLES = {'
        ]
        for step in self.steps:
            if step.get('hidden'): continue
            act = (step.get('action') or '').lower()
            if act in ('input', 'change', 'textarea_input', 'type', 'select'):
                var_key = sanitize_var_name(step.get('title') or f"step_{step.get('sequence', 1)}_input")
                val = self.variables.get(var_key, step.get('value') or '')
                script_lines.append(f'    "{var_key}": "{val}",')
        script_lines.extend([
            '}',
            '',
            'def run_procbot(variables: dict = None, headless: bool = False):',
            '    vars_map = {**VARIABLES, **(variables or {})}',
            f'    print(f"🤖 Starting ProcBot Execution: {self.workflow_name}")',
            '',
            '    with sync_playwright() as p:',
            '        browser = p.chromium.launch(headless=headless, slow_mo=300)',
            '        context = browser.new_context(viewport={"width": 1440, "height": 900})',
            '        page = context.new_page()',
            '        page.set_default_timeout(10000)',
            '',
        ])
        for i, step in enumerate(self.steps, 1):
            if step.get('hidden'): continue
            act = (step.get('action') or '').lower()
            url = step.get('url') or ''
            title = (step.get('edited_title') or step.get('title') or f'Step {i}').replace('"', '')
            val = step.get('value') or ''
            var_key = sanitize_var_name(title or f"step_{step.get('sequence', i)}_input")
            sel_info = self._extract_selector(step)

            script_lines.append(f'        # Step {i}: {title}')
            script_lines.append(f'        print(f"▶️ [Step {i}/{len(self.steps)}] {title}")')
            if act in ('navigate', 'page_load') or i == 1:
                target_url = url if url.startswith('http') else f'https://{url}' if url else 'https://google.com'
                script_lines.append(f'        page.goto("{target_url}", wait_until="domcontentloaded")')
                script_lines.append('        time.sleep(1.0)')
                if act in ('navigate', 'page_load'): continue

            if act in ('input', 'change', 'textarea_input', 'type', 'select'):
                pw_sel = sel_info['playwright'].replace('"', '\\"')
                script_lines.append(f'        target_val = vars_map.get("{var_key}", "{val}")')
                script_lines.append('        try:')
                script_lines.append(f'            page.wait_for_selector("{pw_sel}", state="visible", timeout=6000)')
                script_lines.append(f'            page.fill("{pw_sel}", target_val)')
                script_lines.append('        except Exception:')
                script_lines.append('            page.keyboard.type(target_val)')
                script_lines.append('        time.sleep(0.4)')
            elif act in ('click', 'desktop_left_click'):
                pw_sel = sel_info['playwright'].replace('"', '\\"')
                script_lines.append('        try:')
                script_lines.append(f'            page.wait_for_selector("{pw_sel}", state="visible", timeout=6000)')
                script_lines.append(f'            page.click("{pw_sel}")')
                script_lines.append('        except Exception as e:')
                script_lines.append(f'            print(f"⚠️ Click fallback: {{e}}")')
                script_lines.append('        time.sleep(0.5)')
            elif act in ('keypress_enter', 'keyboard_shortcut'):
                script_lines.append('        page.keyboard.press("Enter")')
                script_lines.append('        time.sleep(0.8)')
            script_lines.append('')

        script_lines.extend([
            '        print("🎉 [ProcBot] Execution completed successfully!")',
            '        time.sleep(2.0)',
            '        browser.close()',
            '',
            'if __name__ == "__main__":',
            '    run_procbot(headless="--headless" in sys.argv)',
        ])
        return '\n'.join(script_lines)

    def generate_selenium_script(self) -> str:
        script_lines = [
            '# ProcBot RPA Automation Script (Selenium)',
            f'# Workflow: {self.workflow_name}',
            '# Run: pip install selenium webdriver-manager',
            '',
            'import time',
            'import sys',
            'from selenium import webdriver',
            'from selenium.webdriver.common.by import By',
            'from selenium.webdriver.common.keys import Keys',
            'from selenium.webdriver.chrome.service import Service',
            'from selenium.webdriver.support.ui import WebDriverWait',
            'from selenium.webdriver.support import expected_conditions as EC',
            'from webdriver_manager.chrome import ChromeDriverManager',
            '',
            'VARIABLES = {'
        ]
        for step in self.steps:
            if step.get('hidden'): continue
            act = (step.get('action') or '').lower()
            if act in ('input', 'change', 'textarea_input', 'type', 'select'):
                var_key = sanitize_var_name(step.get('title') or f"step_{step.get('sequence', 1)}_input")
                val = self.variables.get(var_key, step.get('value') or '')
                script_lines.append(f'    "{var_key}": "{val}",')
        script_lines.extend([
            '}',
            '',
            'def run_procbot(variables: dict = None, headless: bool = False):',
            '    vars_map = {**VARIABLES, **(variables or {})}',
            f'    print(f"🤖 Starting ProcBot Selenium RPA: {self.workflow_name}")',
            '',
            '    options = webdriver.ChromeOptions()',
            '    if headless: options.add_argument("--headless=new")',
            '    options.add_argument("--window-size=1440,900")',
            '    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)',
            '    wait = WebDriverWait(driver, 8)',
            '',
        ])
        for i, step in enumerate(self.steps, 1):
            if step.get('hidden'): continue
            act = (step.get('action') or '').lower()
            url = step.get('url') or ''
            title = (step.get('edited_title') or step.get('title') or f'Step {i}').replace('"', '')
            val = step.get('value') or ''
            var_key = sanitize_var_name(title or f"step_{step.get('sequence', i)}_input")
            sel_info = self._extract_selector(step)

            script_lines.append(f'        # Step {i}: {title}')
            script_lines.append(f'        print(f"▶️ [Step {i}/{len(self.steps)}] {title}")')
            if act in ('navigate', 'page_load') or i == 1:
                target_url = url if url.startswith('http') else f'https://{url}' if url else 'https://google.com'
                script_lines.append(f'        driver.get("{target_url}")')
                script_lines.append('        time.sleep(1.0)')
                if act in ('navigate', 'page_load'): continue

            if act in ('input', 'change', 'textarea_input', 'type', 'select'):
                by_sel = sel_info['selenium']
                script_lines.append(f'        target_val = vars_map.get("{var_key}", "{val}")')
                script_lines.append('        try:')
                script_lines.append(f'            el = wait.until(EC.presence_of_element_located(({by_sel})))')
                script_lines.append('            el.clear()')
                script_lines.append('            el.send_keys(target_val)')
                script_lines.append('        except Exception as e:')
                script_lines.append(f'            print(f"⚠️ Input fallback: {{e}}")')
                script_lines.append('        time.sleep(0.4)')
            elif act in ('click', 'desktop_left_click'):
                by_sel = sel_info['selenium']
                script_lines.append('        try:')
                script_lines.append(f'            el = wait.until(EC.element_to_be_clickable(({by_sel})))')
                script_lines.append('            el.click()')
                script_lines.append('        except Exception as e:')
                script_lines.append(f'            print(f"⚠️ Click fallback: {{e}}")')
                script_lines.append('        time.sleep(0.5)')
            elif act in ('keypress_enter', 'keyboard_shortcut'):
                script_lines.append('        try:')
                script_lines.append('            webdriver.ActionChains(driver).send_keys(Keys.ENTER).perform()')
                script_lines.append('        except Exception: pass')
                script_lines.append('        time.sleep(0.8)')
            script_lines.append('')

        script_lines.extend([
            '        print("🎉 [ProcBot] Selenium execution completed successfully!")',
            '        time.sleep(2.0)',
            '        driver.quit()',
            '',
            'if __name__ == "__main__":',
            '    run_procbot(headless="--headless" in sys.argv)',
        ])
        return '\n'.join(script_lines)

    def generate_json_recipe(self) -> Dict[str, Any]:
        recipe_steps = []
        for i, step in enumerate(self.steps, 1):
            if step.get('hidden'): continue
            act = (step.get('action') or '').lower()
            title = step.get('edited_title') or step.get('title') or f'Step {i}'
            var_key = sanitize_var_name(title or f"step_{step.get('sequence', i)}_input")
            val = self.variables.get(var_key, step.get('value') or '')
            sel_info = self._extract_selector(step)
            recipe_steps.append({
                'sequence': i,
                'action': act,
                'title': title,
                'url': step.get('url'),
                'value': val,
                'variable_key': var_key,
                'selector': sel_info['selector'],
                'strategy': sel_info['strategy'],
                'element': step.get('element'),
                'delay_ms': 500,
            })
        return {
            'name': self.workflow_name,
            'version': '1.0',
            'engine': 'procbot_rpa',
            'variables': self.variables,
            'total_steps': len(recipe_steps),
            'steps': recipe_steps
        }
