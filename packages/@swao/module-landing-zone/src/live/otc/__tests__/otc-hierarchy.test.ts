// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3881: kinds of the OTC IAM projects (live 2026-11-05: eu-de, eu-nl and the
// system project MOS under the domain; sub-projects under a region project).

import { describe, it, expect } from 'vitest';
import { OTC_DEFAULT_EPS, otcProjectNode } from '../otc-hierarchy.js';
import { otcDriver } from '../otc-driver.js';

describe('otcProjectNode (#3881)', () => {
  it('region project, system project and sub-project; every other property goes into attributes', () => {
    expect(otcProjectNode({ id: 'p1', name: 'eu-de', domain_id: 'd', parent_id: 'd', enabled: true, is_domain: false, description: '', links: { self: 'x' } }, 'd'))
      .toEqual({ id: 'p1', kind: 'region', native_kind: 'otc:region-project', parent: 'd', name: 'eu-de', attributes: { enabled: true, is_domain: false, description: '' } });
    expect(otcProjectNode({ id: 'p2', name: 'MOS', domain_id: 'd', parent_id: 'd' }, 'd')).toMatchObject({ kind: 'project', native_kind: 'otc:system-project', parent: 'd' });
    expect(otcProjectNode({ id: 'p3', name: 'eu-ch2', domain_id: 'd', parent_id: 'd' }, 'd')).toMatchObject({ kind: 'region' });
    expect(otcProjectNode({ id: 'p4', name: 'eu-de_app1', domain_id: 'd', parent_id: 'p1' }, 'd')).toMatchObject({ kind: 'project', native_kind: 'otc:project', parent: 'p1' });
  });

  it('the driver declares listHierarchy, the regional EPS host and both hierarchy routes', () => {
    expect(typeof otcDriver.listHierarchy).toBe('function');
    expect(otcDriver.defaultBaseUrls['eps']).toBe(OTC_DEFAULT_EPS);
    expect(OTC_DEFAULT_EPS).toBe('https://eps.eu-de.otc.t-systems.com/v1.0');
    expect(otcDriver.routeTemplates).toEqual(expect.arrayContaining(['/v3/projects', '/v1.0/enterprise-projects']));
  });
});
