"""
ProcSnap Event Normalization Engine - Phase 2
Canonical Event Model, Noise Reduction, Action Grouper, Semantic Classifier
"""
import re
from typing import List, Optional, Dict, Any
from dataclasses import dataclass, field


@dataclass
class CanonicalEvent:
    event_id: str
    source: str
    application: str
    action_type: str
    semantic_class: str
    target_name: str
    target_role: str
    url: Optional[str]
    value: Optional[str]
    timestamp: str
    screenshot_id: Optional[str]
    confidence: int
    noise_flags: List[str] = field(default_factory=list)
    group_id: Optional[str] = None
    sequence: int = 0


SUBMIT_PATTERNS   = re.compile(r'\b(save|submit|send|create|add|post|publish|confirm|finish|complete|done)\b', re.I)
APPROVE_PATTERNS  = re.compile(r'\b(approve|authorize|accept|grant|sign off|sign-off)\b', re.I)
VALIDATE_PATTERNS = re.compile(r'\b(validate|verify|check|review|inspect)\b', re.I)
NAVIGATE_PATTERNS = re.compile(r'\b(go to|navigate|open|launch|back|forward|home|menu|tab)\b', re.I)
DELETE_PATTERNS   = re.compile(r'\b(delete|remove|cancel|discard|reject|deny)\b', re.I)
SEARCH_PATTERNS   = re.compile(r'\b(search|find|filter|look up|query)\b', re.I)
DECISION_PATTERNS = re.compile(r'\b(yes|no|ok|cancel|proceed|skip|if|else|choose|select option)\b', re.I)


class SemanticClassifier:
    def classify(self, action: str, title: str, value: Optional[str], url: Optional[str]) -> str:
        action = (action or '').lower()
        target = (title or '').lower()
        if action in ('navigate', 'page_load'):
            return 'Navigation'
        if action in ('input', 'textarea_input', 'type', 'change'):
            return 'DataEntry'
        if SUBMIT_PATTERNS.search(target):
            return 'Submission'
        if APPROVE_PATTERNS.search(target):
            return 'Approval'
        if VALIDATE_PATTERNS.search(target):
            return 'Validation'
        if DELETE_PATTERNS.search(target):
            return 'Deletion'
        if SEARCH_PATTERNS.search(target):
            return 'Search'
        if DECISION_PATTERNS.search(target):
            return 'Decision'
        if action in ('keypress_enter', 'keyboard_shortcut'):
            return 'Submission'
        return 'Selection'


class NoiseReducer:
    def __init__(self, rapid_click_threshold_ms: int = 350):
        self.rapid_click_threshold_ms = rapid_click_threshold_ms

    def reduce(self, steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not steps:
            return steps
        cleaned = []
        prev = None
        for step in steps:
            if step.get('hidden'):
                continue
            flags = []
            if prev:
                prev_ts = self._parse_ms(prev.get('timestamp', ''))
                curr_ts = self._parse_ms(step.get('timestamp', ''))
                delta_ms = abs(curr_ts - prev_ts)
                if (delta_ms < self.rapid_click_threshold_ms
                        and step.get('action') == prev.get('action')
                        and step.get('url') == prev.get('url')
                        and (step.get('title') or '') == (prev.get('title') or '')):
                    flags.append('rapid_duplicate')
                    continue
            if step.get('action') in ('input', 'change') and not (step.get('value') or '').strip():
                flags.append('empty_input')
            step = dict(step)
            step['noise_flags'] = flags
            cleaned.append(step)
            prev = step
        return cleaned

    def _parse_ms(self, ts: str) -> float:
        try:
            from datetime import datetime
            dt = datetime.fromisoformat(ts.rstrip('Z'))
            return dt.timestamp() * 1000
        except Exception:
            return 0.0


@dataclass
class StepGroup:
    group_id: str
    step_ids: List[int]
    suggested_title: str
    suggested_description: str
    confidence: int
    semantic_class: str


class ActionGrouper:
    def __init__(self, max_group_size=8, max_group_duration_sec=45.0, min_group_size=3):
        self.max_group_size = max_group_size
        self.max_group_duration_sec = max_group_duration_sec
        self.min_group_size = min_group_size
        self._counter = 0

    def suggest_groups(self, steps: List[Dict[str, Any]]) -> List[StepGroup]:
        groups = []
        if not steps:
            return groups
        i = 0
        while i < len(steps):
            step = steps[i]
            action = step.get('action', '')
            if action not in ('input', 'change', 'textarea_input', 'type', 'select'):
                i += 1
                continue
            current_url = step.get('url', '')
            group_steps = [step]
            j = i + 1
            while j < len(steps) and len(group_steps) < self.max_group_size:
                next_step = steps[j]
                next_action = next_step.get('action', '')
                if (next_action in ('input', 'change', 'textarea_input', 'type', 'select', 'keypress_enter')
                        and next_step.get('url', '') == current_url):
                    group_steps.append(next_step)
                    j += 1
                else:
                    break
            if len(group_steps) >= self.min_group_size:
                try:
                    t0 = self._ts(group_steps[0].get('timestamp', ''))
                    t1 = self._ts(group_steps[-1].get('timestamp', ''))
                    duration = abs(t1 - t0)
                except Exception:
                    duration = 0.0
                if duration <= self.max_group_duration_sec:
                    self._counter += 1
                    gid = f"grp_{self._counter:03d}"
                    page_title = group_steps[0].get('title', 'this form') or 'this form'
                    groups.append(StepGroup(
                        group_id=gid,
                        step_ids=[s['id'] for s in group_steps if s.get('id')],
                        suggested_title=f"Enter information in {page_title}",
                        suggested_description=(
                            f"Fill in {len(group_steps)} fields including "
                            + ', '.join((s.get('title') or 'a field')[:20] for s in group_steps[:3])
                            + ('...' if len(group_steps) > 3 else '.')
                        ),
                        confidence=min(95, 60 + len(group_steps) * 5),
                        semantic_class='DataEntry',
                    ))
                    i = j
                    continue
            i += 1
        return groups

    def _ts(self, ts: str) -> float:
        try:
            from datetime import datetime
            return datetime.fromisoformat(ts.rstrip('Z')).timestamp()
        except Exception:
            return 0.0


def normalize_steps(steps: List[Dict[str, Any]], reduce_noise=True, suggest_groups=True) -> Dict[str, Any]:
    original_count = len(steps)
    classifier = SemanticClassifier()
    if reduce_noise:
        cleaned = NoiseReducer().reduce(steps)
    else:
        cleaned = list(steps)
    noise_removed = original_count - len(cleaned)
    semantic_map = {}
    for step in cleaned:
        cls = classifier.classify(
            action=step.get('action', ''),
            title=step.get('title', '') or step.get('edited_title', ''),
            value=step.get('value', ''),
            url=step.get('url', ''),
        )
        step_id = str(step.get('id', step.get('sequence', '')))
        semantic_map[step_id] = cls
        step['semantic_class'] = cls
    groups = []
    if suggest_groups:
        raw_groups = ActionGrouper().suggest_groups(cleaned)
        groups = [{'group_id': g.group_id, 'step_ids': g.step_ids, 'suggested_title': g.suggested_title,
                   'suggested_description': g.suggested_description, 'confidence': g.confidence,
                   'semantic_class': g.semantic_class} for g in raw_groups]
    return {'cleaned_steps': cleaned, 'suggested_groups': groups, 'noise_removed_count': noise_removed,
            'semantic_classes': semantic_map, 'original_count': original_count}
