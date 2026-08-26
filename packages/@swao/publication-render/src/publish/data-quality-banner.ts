// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Publication renderer
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #0577: evaluateDataQuality + buildDataQualityFlagsString + DataQualityCondition
// relocated to @swao/core (the manifest -> conditions contract is shared with
// @swao/module-powerbi's star writer, and a module may not import a sibling
// module). Re-exported here so this module's renderer + barrel + tests keep
// importing them from './data-quality-banner.js' unchanged. The HTML-rendering
// helper buildDataQualityBannerHtml stays here -- it is a presentation concern,
// not a shared data contract.
import { evaluateDataQuality, buildDataQualityFlagsString } from '@swao/core';
import type { DataQualityCondition } from '@swao/core';

export { evaluateDataQuality, buildDataQualityFlagsString };
export type { DataQualityCondition };

/**
 * Render the data quality banner as an HTML snippet.
 * Returns an empty string when there are no active conditions (clean run).
 */
export function buildDataQualityBannerHtml(conditions: DataQualityCondition[]): string {
  if (conditions.length === 0) return '';

  const hasError = conditions.some((c) => c.severity === 'error');
  const borderColor = hasError ? '#c62828' : '#e65100';
  const bgColor = hasError ? '#ffebee' : '#fff3e0';
  const iconColor = hasError ? '#c62828' : '#e65100';

  const items = conditions
    .map((c) => {
      const [head, ...tail] = c.message.split(' -- ');
      const detail = tail.length ? ` -- ${tail.join(' -- ')}` : '';
      // Render clickable signal links when signal_ids are provided
      const links = c.signal_ids && c.signal_ids.length > 0
        ? '<span style="display:block;margin-top:6px;font-size:0.8em;">' +
          c.signal_ids.map(id => {
            const tip = c.signal_derivations?.[id] ?? '';
            const titleAttr = tip ? ` title="${tip.replace(/"/g, '&quot;').slice(0, 200)}"` : '';
            return `<a href="#signal-${id}" onclick="event.preventDefault();window.swaoNavigateToSignal&&window.swaoNavigateToSignal('${id}');return false;" ` +
              `style="color:inherit;text-decoration:underline;margin-right:6px;"${titleAttr}>${id}</a>`;
          }).join('') + '</span>'
        : '';
      return `<li style="margin:4px 0;"><strong>${head}</strong>${detail}${links}</li>`;
    })
    .join('');

  return `<div role="alert" aria-label="Data quality warning" style="
    border-left: 4px solid ${borderColor};
    background: ${bgColor};
    padding: 12px 16px;
    margin: 16px 0;
    font-family: sans-serif;
    font-size: 0.875rem;
    color: #212121;
  "><strong style="color:${iconColor};">[DATA QUALITY WARNING]</strong> This assessment has one or more data quality signals.<ul style="margin:8px 0 4px 20px;padding:0;">${items}</ul><p style="margin:8px 0 0;color:#555;">Results should be reviewed before use in a client deliverable.</p></div>`;
}
