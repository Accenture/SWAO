#!/usr/bin/env node
// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// SWAO Enterprise-tier entry (#0583, Sprint 064, ADR-0049 layer 2).
//
// The Enterprise tier bundles every module, which is exactly the full wiring in
// src/index.ts (the default dev / npm / test entry). Rather than duplicate that
// wiring, this entry re-runs it by importing the module for its side effect
// (index.ts computes the spawn descriptor, builds the real portfolio impls,
// wires the pdf renderer + portal builder, registers challenge + generate-tf,
// and calls program.parse()).
//
// Importing index.ts here means the spawn descriptor's import.meta.url resolves
// to index.ts, not this file -- which is correct: index.ts is the canonical
// Enterprise entry, and a pkg binary built from this entry uses process.execPath
// regardless. build-enterprise.mjs may point esbuild at either entry; pointing
// at index.ts directly is the historical path and is preserved by build:bundle.
import '../index.js';
