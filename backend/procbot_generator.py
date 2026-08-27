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
        if step.get('custom_selector'):
            sel = step.get('custom_selector')
            if sel.startswith('//') or sel.startswith('(//'):
                return {'strategy': 'xpath', 'selector': sel, 'playwright': f'xpath={sel}', 'selenium': f'By.XPATH, "{sel}"'}
            return {'strategy': 'css', 'selector': sel, 'playwright': sel, 'selenium': f'By.CSS_SELECTOR, "{sel}"'}

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
        tag_name = (raw_el.get('tagName') or '').lower()
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
            if tag_name == 'button' or (css and 'button' in css):
                return {'strategy': 'text', 'selector': f'button:has-text("{clean_text}")', 'playwright': f'button:has-text("{clean_text}")', 'selenium': f'By.XPATH, "//button[contains(text(), \'{clean_text}\')]"'}
            return {'strategy': 'text', 'selector': f'text={clean_text}', 'playwright': f'text={clean_text}', 'selenium': f'By.XPATH, "//*[contains(text(), \'{clean_text}\')]"'}
        return {'strategy': 'coord', 'selector': f'coord({rect.get("x", 0)}, {rect.get("y", 0)})', 'playwright': '', 'selenium': ''}

    def generate_playwright_script(self) -> str:
        script_lines = [
            '# ProcBot RPA Automation Script (Playwright)',
            f'# Workflow: {self.workflow_name}',
            '# Requirements: pip install playwright && playwright install chromium',
            '',
            'import time',
            'import sys',
            'import csv',
            'import os',
            'from playwright.sync_api import sync_playwright',
            '',
            '# Default Parameter Variables (Override with CLI arguments or CSV batch data)',
            'DEFAULT_VARIABLES = {'
        ]
        for idx, step in enumerate(self.steps, 1):
            if step.get('hidden'): continue
            act = (step.get('action') or '').lower()
            if act in ('input', 'change', 'textarea_input', 'type', 'select'):
                title = step.get('edited_title') or step.get('title') or f"step_{idx}_input"
                var_key = sanitize_var_name(title)
                val = self.variables.get(var_key, step.get('value') or '')
                script_lines.append(f'    "{var_key}": "{val}",')
        script_lines.extend([
            '}',
            '',
            'def execute_procbot_run(page, variables: dict):',
            f'    print(f"\\n🤖 [ProcBot] Executing RPA Workflow: {self.workflow_name}")',
            '    vars_map = {**DEFAULT_VARIABLES, **variables}',
            '',
        ])

        for i, step in enumerate(self.steps, 1):
            if step.get('hidden'): continue
            act = (step.get('action') or '').lower()
            url = step.get('url') or ''
            title = (step.get('edited_title') or step.get('title') or f'Step {i}').replace('"', '\\"')
            val = step.get('value') or ''
            var_key = sanitize_var_name(step.get('edited_title') or step.get('title') or f"step_{i}_input")
            sel_info = self._extract_selector(step)
            is_manual_pause = step.get('manual_pause') or step.get('_manualPause') or act in ('manual_pause', 'manual_task')
            note = (step.get('manual_instructions') or step.get('note') or 'Perform manual action on screen').replace('"', '\\"')

            script_lines.append(f'    # Step {i}: {title}')
            script_lines.append(f'    print(f"▶️ [Step {i}/{len(self.steps)}] {title}")')

            # Manual Pause Handler
            if is_manual_pause:
                script_lines.append('    print("\\n" + "="*60)')
                script_lines.append(f'    print("✋ [MANUAL ACTION REQUIRED] Step {i}: {title}")')
                script_lines.append(f'    print("   👉 Instruction: {note}")')
                script_lines.append('    input("   Press [ENTER] in this terminal when finished to resume ProcBot...")')
                script_lines.append('    print("="*60 + "\\n")')
                script_lines.append('    time.sleep(0.5)')
                continue

            if act in ('navigate', 'page_load') or i == 1:
                target_url = url if url.startswith('http') else f'https://{url}' if url else 'https://google.com'
                script_lines.append(f'    page.goto("{target_url}", wait_until="domcontentloaded")')
                script_lines.append('    time.sleep(1.5)')
                if act in ('navigate', 'page_load'):
                    script_lines.append('')
                    continue

            pw_sel = sel_info['playwright'].replace('"', '\\"')

            if act in ('select', 'dropdown'):
                script_lines.append(f'    target_opt = vars_map.get("{var_key}", "{val}")')
                script_lines.append('    try:')
                script_lines.append(f'        page.wait_for_selector("{pw_sel}", state="visible", timeout=6000)')
                script_lines.append(f'        page.select_option("{pw_sel}", label=target_opt)')
                script_lines.append('    except Exception:')
                script_lines.append('        try:')
                script_lines.append(f'            page.select_option("{pw_sel}", value=target_opt)')
                script_lines.append('        except Exception as e:')
                script_lines.append(f'            print(f"   ⚠️ Dropdown select fallback: {{e}}")')
                script_lines.append('    time.sleep(0.4)')
            elif act in ('input', 'change', 'textarea_input', 'type'):
                script_lines.append(f'    target_val = vars_map.get("{var_key}", "{val}")')
                script_lines.append('    try:')
                script_lines.append(f'        page.wait_for_selector("{pw_sel}", state="visible", timeout=6000)')
                script_lines.append(f'        page.fill("{pw_sel}", target_val)')
                script_lines.append('    except Exception:')
                script_lines.append('        page.keyboard.type(target_val)')
                script_lines.append('    time.sleep(0.4)')
            elif act in ('click', 'desktop_left_click'):
                script_lines.append('    try:')
                script_lines.append(f'        page.wait_for_selector("{pw_sel}", state="visible", timeout=6000)')
                script_lines.append(f'        page.click("{pw_sel}")')
                script_lines.append('    except Exception as e:')
                script_lines.append(f'        print(f"   ⚠️ Click fallback: {{e}}")')
                script_lines.append('    time.sleep(0.5)')
            elif act in ('dblclick', 'double_click'):
                script_lines.append('    try:')
                script_lines.append(f'        page.wait_for_selector("{pw_sel}", state="visible", timeout=6000)')
                script_lines.append(f'        page.dblclick("{pw_sel}")')
                script_lines.append('    except Exception as e:')
                script_lines.append(f'        print(f"   ⚠️ Double-click fallback: {{e}}")')
                script_lines.append('    time.sleep(0.5)')
            elif act in ('wait', 'delay'):
                delay_sec = float(val or 1.0)
                script_lines.append(f'    print("   ⏱️ Waiting {delay_sec}s...")')
                script_lines.append(f'    time.sleep({delay_sec})')
            elif act in ('keypress_enter', 'keyboard_shortcut', 'enter'):
                script_lines.append('    page.keyboard.press("Enter")')
                script_lines.append('    time.sleep(0.8)')
            else:
                script_lines.append('    try:')
                script_lines.append(f'        page.click("{pw_sel}")')
                script_lines.append('    except Exception: pass')
                script_lines.append('    time.sleep(0.4)')
            script_lines.append('')

        script_lines.extend([
            '    print("✅ [ProcBot] Run completed successfully!")',
            '',
            'def main():',
            '    headless = "--headless" in sys.argv',
            '    csv_path = None',
            '    for arg in sys.argv:',
            '        if arg.startswith("--csv="):',
            '            csv_path = arg.split("=", 1)[1]',
            '',
            '    datasets = [{}]',
            '    if csv_path and os.path.exists(csv_path):',
            '        with open(csv_path, encoding="utf-8") as f:',
            '            reader = csv.DictReader(f)',
            '            datasets = [row for row in reader if row]',
            '        print(f"📊 Loaded {len(datasets)} data row(s) from {csv_path}")',
            '',
            '    with sync_playwright() as p:',
            '        browser = p.chromium.launch(headless=headless, slow_mo=300)',
            '        context = browser.new_context(viewport={"width": 1440, "height": 900})',
            '        page = context.new_page()',
            '        page.set_default_timeout(10000)',
            '',
            '        for run_idx, dataset in enumerate(datasets, 1):',
            '            if len(datasets) > 1:',
            '                print(f"\\n🔄 [Batch Run {run_idx}/{len(datasets)}]")',
            '            execute_procbot_run(page, dataset)',
            '            time.sleep(1.0)',
            '',
            '        print("\\n🎉 [ProcBot RPA Engine] All executions finished successfully!")',
            '        time.sleep(2.0)',
            '        browser.close()',
            '',
            'if __name__ == "__main__":',
            '    main()',
        ])
        return '\n'.join(script_lines)

    def generate_selenium_script(self) -> str:
        script_lines = [
            '# ProcBot RPA Automation Script (Selenium WebDriver)',
            f'# Workflow: {self.workflow_name}',
            '# Requirements: pip install selenium webdriver-manager',
            '',
            'import time',
            'import sys',
            'import csv',
            'import os',
            'from selenium import webdriver',
            'from selenium.webdriver.common.by import By',
            'from selenium.webdriver.common.keys import Keys',
            'from selenium.webdriver.chrome.service import Service',
            'from selenium.webdriver.support.ui import WebDriverWait, Select',
            'from selenium.webdriver.support import expected_conditions as EC',
            'from webdriver_manager.chrome import ChromeDriverManager',
            '',
            '# Default Parameter Variables',
            'DEFAULT_VARIABLES = {'
        ]
        for idx, step in enumerate(self.steps, 1):
            if step.get('hidden'): continue
            act = (step.get('action') or '').lower()
            if act in ('input', 'change', 'textarea_input', 'type', 'select'):
                title = step.get('edited_title') or step.get('title') or f"step_{idx}_input"
                var_key = sanitize_var_name(title)
                val = self.variables.get(var_key, step.get('value') or '')
                script_lines.append(f'    "{var_key}": "{val}",')
        script_lines.extend([
            '}',
            '',
            'def execute_procbot_run(driver, wait, variables: dict):',
            f'    print(f"\\n🤖 [ProcBot] Executing Selenium RPA: {self.workflow_name}")',
            '    vars_map = {**DEFAULT_VARIABLES, **variables}',
            '',
        ])

        for i, step in enumerate(self.steps, 1):
            if step.get('hidden'): continue
            act = (step.get('action') or '').lower()
            url = step.get('url') or ''
            title = (step.get('edited_title') or step.get('title') or f'Step {i}').replace('"', '\\"')
            val = step.get('value') or ''
            var_key = sanitize_var_name(step.get('edited_title') or step.get('title') or f"step_{i}_input")
            sel_info = self._extract_selector(step)
            is_manual_pause = step.get('manual_pause') or step.get('_manualPause') or act in ('manual_pause', 'manual_task')
            note = (step.get('manual_instructions') or step.get('note') or 'Perform manual action on screen').replace('"', '\\"')

            script_lines.append(f'    # Step {i}: {title}')
            script_lines.append(f'    print(f"▶️ [Step {i}/{len(self.steps)}] {title}")')

            # Manual Pause Handler
            if is_manual_pause:
                script_lines.append('    print("\\n" + "="*60)')
                script_lines.append(f'    print("✋ [MANUAL ACTION REQUIRED] Step {i}: {title}")')
                script_lines.append(f'    print("   👉 Instruction: {note}")')
                script_lines.append('    input("   Press [ENTER] in this terminal when finished to resume ProcBot...")')
                script_lines.append('    print("="*60 + "\\n")')
                script_lines.append('    time.sleep(0.5)')
                continue

            if act in ('navigate', 'page_load') or i == 1:
                target_url = url if url.startswith('http') else f'https://{url}' if url else 'https://google.com'
                script_lines.append(f'    driver.get("{target_url}")')
                script_lines.append('    time.sleep(1.5)')
                if act in ('navigate', 'page_load'):
                    script_lines.append('')
                    continue

            by_sel = sel_info['selenium']

            if act in ('select', 'dropdown'):
                script_lines.append(f'    target_opt = vars_map.get("{var_key}", "{val}")')
                script_lines.append('    try:')
                script_lines.append(f'        el = wait.until(EC.presence_of_element_located(({by_sel})))')
                script_lines.append('        try:')
                script_lines.append('            Select(el).select_by_visible_text(target_opt)')
                script_lines.append('        except Exception:')
                script_lines.append('            Select(el).select_by_value(target_opt)')
                script_lines.append('    except Exception as e:')
                script_lines.append(f'        print(f"   ⚠️ Dropdown fallback: {{e}}")')
                script_lines.append('    time.sleep(0.4)')
            elif act in ('input', 'change', 'textarea_input', 'type'):
                script_lines.append(f'    target_val = vars_map.get("{var_key}", "{val}")')
                script_lines.append('    try:')
                script_lines.append(f'        el = wait.until(EC.presence_of_element_located(({by_sel})))')
                script_lines.append('        el.clear()')
                script_lines.append('        el.send_keys(target_val)')
                script_lines.append('    except Exception as e:')
                script_lines.append(f'        print(f"   ⚠️ Input fallback: {{e}}")')
                script_lines.append('    time.sleep(0.4)')
            elif act in ('click', 'desktop_left_click'):
                script_lines.append('    try:')
                script_lines.append(f'        el = wait.until(EC.element_to_be_clickable(({by_sel})))')
                script_lines.append('        el.click()')
                script_lines.append('    except Exception as e:')
                script_lines.append(f'        print(f"   ⚠️ Click fallback: {{e}}")')
                script_lines.append('    time.sleep(0.5)')
            elif act in ('wait', 'delay'):
                delay_sec = float(val or 1.0)
                script_lines.append(f'    print("   ⏱️ Waiting {delay_sec}s...")')
                script_lines.append(f'    time.sleep({delay_sec})')
            elif act in ('keypress_enter', 'keyboard_shortcut', 'enter'):
                script_lines.append('    try:')
                script_lines.append('        webdriver.ActionChains(driver).send_keys(Keys.ENTER).perform()')
                script_lines.append('    except Exception: pass')
                script_lines.append('    time.sleep(0.8)')
            else:
                script_lines.append('    try:')
                script_lines.append(f'        driver.find_element({by_sel}).click()')
                script_lines.append('    except Exception: pass')
                script_lines.append('    time.sleep(0.4)')
            script_lines.append('')

        script_lines.extend([
            '    print("✅ [ProcBot] Run completed successfully!")',
            '',
            'def main():',
            '    headless = "--headless" in sys.argv',
            '    csv_path = None',
            '    for arg in sys.argv:',
            '        if arg.startswith("--csv="):',
            '            csv_path = arg.split("=", 1)[1]',
            '',
            '    datasets = [{}]',
            '    if csv_path and os.path.exists(csv_path):',
            '        with open(csv_path, encoding="utf-8") as f:',
            '            reader = csv.DictReader(f)',
            '            datasets = [row for row in reader if row]',
            '        print(f"📊 Loaded {len(datasets)} data row(s) from {csv_path}")',
            '',
            '    options = webdriver.ChromeOptions()',
            '    if headless: options.add_argument("--headless=new")',
            '    options.add_argument("--window-size=1440,900")',
            '    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)',
            '    wait = WebDriverWait(driver, 8)',
            '',
            '    for run_idx, dataset in enumerate(datasets, 1):',
            '        if len(datasets) > 1:',
            '            print(f"\\n🔄 [Batch Run {run_idx}/{len(datasets)}]")',
            '        execute_procbot_run(driver, wait, dataset)',
            '        time.sleep(1.0)',
            '',
            '    print("\\n🎉 [ProcBot Selenium Engine] All executions finished successfully!")',
            '    time.sleep(2.0)',
            '    driver.quit()',
            '',
            'if __name__ == "__main__":',
            '    main()',
        ])
        return '\n'.join(script_lines)

    def generate_json_recipe(self) -> Dict[str, Any]:
        recipe_steps = []
        for i, step in enumerate(self.steps, 1):
            if step.get('hidden'): continue
            act = (step.get('action') or '').lower()
            title = step.get('edited_title') or step.get('title') or f'Step {i}'
            var_key = sanitize_var_name(title)
            val = self.variables.get(var_key, step.get('value') or '')
            sel_info = self._extract_selector(step)
            is_manual_pause = step.get('manual_pause') or step.get('_manualPause') or act in ('manual_pause', 'manual_task')
            note = step.get('manual_instructions') or step.get('note') or ''

            recipe_steps.append({
                'sequence': i,
                'action': 'manual_pause' if is_manual_pause else act,
                'title': title,
                'url': step.get('url'),
                'value': val,
                'variable_key': var_key,
                'selector': sel_info['selector'],
                'strategy': sel_info['strategy'],
                'element': step.get('element'),
                'manual_pause': bool(is_manual_pause),
                'manual_instructions': note,
                'delay_ms': step.get('delay_ms', 500),
            })
        return {
            'name': self.workflow_name,
            'version': '2.0',
            'engine': 'procbot_rpa',
            'variables': self.variables,
            'total_steps': len(recipe_steps),
            'steps': recipe_steps
        }
