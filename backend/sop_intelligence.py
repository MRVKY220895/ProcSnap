"""
ProcSnap SOP Intelligence Engine - Phase 3
Auto Title Generation, Description Generation, Process Metadata, Intent Markers
All rule-based — no external AI required.
"""
import re
from typing import List, Optional, Dict, Any, Tuple
from urllib.parse import urlparse


TITLE_MAP = [
    ('click',    re.compile(r'\b(save|save as)\b', re.I),          'Save the Record'),
    ('click',    re.compile(r'\b(submit)\b', re.I),                'Submit the Request'),
    ('click',    re.compile(r'\b(create|add new|new)\b', re.I),    'Create a New {entity}'),
    ('click',    re.compile(r'\b(publish|post)\b', re.I),          'Publish the {entity}'),
    ('click',    re.compile(r'\b(finish|complete|done)\b', re.I),  'Complete the Process'),
    ('click',    re.compile(r'\b(confirm)\b', re.I),               'Confirm the Action'),
    ('click',    re.compile(r'\b(approve|authorize|sign off)\b', re.I), 'Approve the Request'),
    ('click',    re.compile(r'\b(reject|deny|decline)\b', re.I),   'Reject the Request'),
    ('click',    re.compile(r'\b(validate|verify)\b', re.I),       'Validate the Information'),
    ('click',    re.compile(r'\b(check|review)\b', re.I),          'Review the Details'),
    ('navigate', None,                                              'Navigate to {page}'),
    ('click',    re.compile(r'\b(back|return|go back)\b', re.I),   'Return to Previous Page'),
    ('click',    re.compile(r'\b(next|continue|proceed)\b', re.I), 'Continue to Next Step'),
    ('input',    None,                                              'Enter {element}'),
    ('change',   None,                                              'Select {element}'),
    ('select',   None,                                              'Choose {element}'),
    ('click',    re.compile(r'\b(search|find|look)\b', re.I),      'Search for {value}'),
    ('keypress_enter', None,                                        'Submit the Search'),
    ('click',    re.compile(r'\b(delete|remove)\b', re.I),         'Delete the {entity}'),
    ('click',    re.compile(r'\b(cancel|discard)\b', re.I),        'Cancel and Discard Changes'),
    ('click',    None,                                              'Click {element}'),
    ('desktop_left_click',  None,                                   'Click {element}'),
    ('desktop_right_click', None,                                   'Right-Click {element}'),
    ('keyboard_shortcut',   None,                                   'Use Keyboard Shortcut'),
]

DESC_TEMPLATES = {
    'Submission':  'Review the information and click {element} to {verb} it. Ensure all required fields are completed before proceeding.',
    'Approval':    'Review the pending request and click {element} to {verb}. This step requires authorisation before the process can continue.',
    'Validation':  'Review the entered details and click {element} to {verb} the information. The system will confirm whether all data is correct.',
    'DataEntry':   'Enter the required information into the {element} field. Ensure the value is accurate before continuing.',
    'Navigation':  'Navigate to {page} by selecting {element}. The next screen will load automatically.',
    'Search':      'Enter your search term into the {element} field and press Enter or click Search to retrieve results.',
    'Selection':   'Click {element} to select it and proceed to the next step.',
    'Deletion':    'Click {element} to remove the selected item. This action may be irreversible — confirm before proceeding.',
    'Decision':    'Review the information and click {element} to choose the appropriate path.',
    'Completion':  'Click {element} to finalise and complete the process. A confirmation message will appear on success.',
    'Default':     'Click {element} to perform this action and continue to the next step.',
}

ACTION_VERBS = {
    'save': 'save', 'submit': 'submit', 'approve': 'approve', 'reject': 'reject',
    'validate': 'validate', 'verify': 'verify', 'delete': 'delete', 'create': 'create',
    'confirm': 'confirm', 'publish': 'publish', 'complete': 'complete', 'cancel': 'cancel',
}

INTENT_MARKERS = [
    '\U0001f534 Important', '\u26a0\ufe0f Warning', '\U0001f500 Decision', '\U0001f6a8 Exception',
    '\U0001f4cb Business Rule', '\u2705 Approval Required', '\U0001f4ce Evidence Required', '\u274c Common Mistake',
]


def _page_from_url(url: str) -> str:
    try:
        host = urlparse(url).hostname or ''
        host = re.sub(r'^www\.', '', host)
        parts = host.split('.')
        return parts[0].capitalize() if parts else 'the application'
    except Exception:
        return 'the application'


def _element_name(step: dict) -> str:
    el = step.get('element') or {}
    if isinstance(el, dict):
        return (el.get('text') or el.get('ariaLabel') or el.get('name') or
                el.get('placeholder') or el.get('title') or '')
    return ''


class TitleGenerator:
    def generate(self, step: dict) -> str:
        action = (step.get('action') or '').lower()
        raw_title = step.get('title') or step.get('edited_title') or ''
        value = step.get('value') or ''
        url = step.get('url') or ''
        el_name = _element_name(step)
        page = _page_from_url(url)
        words = re.findall(r'[A-Za-z]{3,}', el_name or raw_title)
        entity = words[-1].capitalize() if words else 'Item'
        for (act, pattern, template) in TITLE_MAP:
            if not (action == act or action.startswith(act)):
                continue
            if pattern is None or pattern.search(raw_title) or pattern.search(el_name):
                t = template
                t = t.replace('{element}', el_name or raw_title or 'the field')
                t = t.replace('{page}', page)
                t = t.replace('{entity}', entity)
                t = t.replace('{value}', (value[:30] + '...') if len(value) > 30 else (value or 'the item'))
                return self._clean(t)
        return self._clean(raw_title[:80]) if raw_title else f'Perform Action ({action})'

    def _clean(self, t: str) -> str:
        t = t.strip()
        return (t[0].upper() + t[1:]) if t and t[0].islower() else t


class DescriptionGenerator:
    def generate(self, step: dict, semantic_class: Optional[str] = None) -> str:
        raw_title = step.get('title') or step.get('edited_title') or ''
        url = step.get('url') or ''
        el_name = _element_name(step) or raw_title or 'the control'
        page = _page_from_url(url)
        sem = semantic_class or 'Default'
        template = DESC_TEMPLATES.get(sem, DESC_TEMPLATES['Default'])
        verb = 'complete'
        for kw, v in ACTION_VERBS.items():
            if kw in raw_title.lower():
                verb = v
                break
        return (template
                .replace('{element}', f'"{el_name}"')
                .replace('{verb}', verb)
                .replace('{page}', page))


class MetadataGenerator:
    def generate_sop_metadata(self, steps: List[dict]) -> dict:
        if not steps:
            return {}
        applications = self._extract_applications(steps)
        first_title = steps[0].get('title') or steps[0].get('edited_title') or ''
        last_title  = steps[-1].get('title') or steps[-1].get('edited_title') or ''
        app_str = applications[0] if applications else 'the application'
        if first_title and last_title:
            purpose = f"This procedure describes how to {first_title.lower()} through to {last_title.lower()} in {app_str}."
        elif first_title:
            purpose = f"This procedure describes how to {first_title.lower()} in {app_str}."
        else:
            purpose = f"This procedure documents the process performed in {app_str}."
        scope = f"This procedure applies to {', '.join(applications[:4]) if applications else 'the application'} users."
        prereqs = [f"Access to {applications[0]}"] if applications else []
        if any('login' in (s.get('url') or '').lower() or 'sign in' in (s.get('title') or '').lower() for s in steps[:3]):
            prereqs.append('Valid login credentials')
        roles = []
        for s in steps:
            if any(kw in (s.get('title') or '').lower() for kw in ['approve', 'authorize', 'manager', 'admin', 'supervisor']):
                roles.append('Approver / Manager')
                break
        roles.append('Process Operator')
        roles = list(dict.fromkeys(roles))
        expected = f"The process is complete after: {last_title}." if last_title else ''
        total_steps = len(steps)
        try:
            from datetime import datetime
            t0 = datetime.fromisoformat(steps[0].get('timestamp', '').rstrip('Z')).timestamp()
            t1 = datetime.fromisoformat(steps[-1].get('timestamp', '').rstrip('Z')).timestamp()
            duration_min = max(1, int((t1 - t0) / 60))
        except Exception:
            duration_min = None
        return {'purpose': purpose, 'scope': scope, 'prerequisites': prereqs, 'roles': roles,
                'applications': applications, 'expected_outcome': expected,
                'estimated_duration_min': duration_min, 'total_steps': total_steps,
                'suggested_tags': applications[:3]}

    def generate_step_titles(self, steps: List[dict], force: bool = True) -> dict:
        gen = TitleGenerator()
        if force:
            return {s['id']: gen.generate(s) for s in steps}
        return {s['id']: gen.generate(s) for s in steps if not (s.get('edited_title') or '').strip()}

    def generate_step_descriptions(self, steps: List[dict], force: bool = False) -> dict:
        gen = DescriptionGenerator()
        if force:
            return {s['id']: gen.generate(s, s.get('semantic_class')) for s in steps}
        return {s['id']: gen.generate(s, s.get('semantic_class')) for s in steps if not (s.get('edited_description') or '').strip()}


    def _extract_applications(self, steps: List[dict]) -> List[str]:
        seen: dict = {}
        for s in steps:
            url = s.get('url') or ''
            if url.startswith('desktop://'):
                app = url.replace('desktop://', '').split(' - ')[0].strip()
                if app:
                    seen[app] = seen.get(app, 0) + 1
            elif url.startswith('http'):
                try:
                    host = re.sub(r'^www\.', '', urlparse(url).hostname or '').split('.')[0].capitalize()
                    if host:
                        seen[host] = seen.get(host, 0) + 1
                except Exception:
                    pass
        return [k for k, _ in sorted(seen.items(), key=lambda x: -x[1])]


def generate_all_suggestions(steps: List[dict]) -> dict:
    meta_gen = MetadataGenerator()
    return {
        'sop_metadata': meta_gen.generate_sop_metadata(steps),
        'title_suggestions': meta_gen.generate_step_titles(steps),
        'description_suggestions': meta_gen.generate_step_descriptions(steps),
        'intent_markers': INTENT_MARKERS,
    }
