// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * #3348 B-01 / B-02 step 2a (Design 122, #3604): the Community and Consultant
 * entries fill the host contract (lib/mcp-chat-contract.ts) with the stubs in
 * this folder: same `swao mcp` / `swao chat` command tree and help, every
 * action refuses; the chat screen shows the upgrade notice; the client helpers
 * are only reached after the MCP registration gate, which always refuses in
 * these editions.
 */

import { registerMcp, defaultTransport, profileToolNames, clientDisplayName, isSwaoGeneratedAgent, renderAgentTemplate } from './module-mcp.js';
import { registerChat } from './chat.js';
import { ChatScreen } from './ChatScreen.js';
import { premiumScreens } from '../../tui/premium-screens.js';
import { registerMcpClientHelpers, type McpChatCommands, type McpClientHelpers } from '../../lib/mcp-chat-contract.js';

export const stubMcpChatCommands: McpChatCommands = { registerMcp, registerChat };

export const stubMcpClientHelpers: McpClientHelpers = {
  defaultTransport,
  profileToolNames,
  clientDisplayName,
  isSwaoGeneratedAgent,
  renderAgentTemplate,
};

/** Registers the stub chat screen and client helpers; returns the CLI slot for buildProgram. */
export function registerStubMcpChat(): McpChatCommands {
  premiumScreens.ChatScreen = ChatScreen;
  registerMcpClientHelpers(stubMcpClientHelpers);
  return stubMcpChatCommands;
}
