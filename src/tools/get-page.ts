import { z } from 'zod';
/* eslint-disable n/no-missing-import */
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, TextContent, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
/* eslint-enable n/no-missing-import */
import { makeActionApiRequest } from '../common/utils.js';
import { ContentFormat } from '../common/mwRestApiContentFormat.js';

interface ActionApiQueryPage {
	pageid: number;
	title: string;
	contentmodel?: string;
	lastrevid?: number;
	missing?: string;
	revisions?: Array<{ timestamp?: string }>;
}

interface ActionApiQueryResponse {
	query?: {
		pages?: Record<string, ActionApiQueryPage>;
	};
}

interface ActionApiParseResponse {
	parse?: {
		title: string;
		pageid: number;
		wikitext?: { '*': string };
		text?: { '*': string };
	};
	error?: { info: string };
}

export function getPageTool( server: McpServer ): RegisteredTool {
	return server.tool(
		'get-page',
		'Returns a wiki page. Use metadata=true to retrieve the revision ID required by update-page. Set content="none" to fetch only metadata without content.',
		{
			title: z.string().describe( 'Wiki page title' ),
			content: z.nativeEnum( ContentFormat ).optional().default( ContentFormat.source ).describe( 'Type of content to return' ),
			metadata: z.boolean().optional().default( false ).describe( 'Whether to include metadata (page ID, revision info, license) in the response' )
		},
		{
			title: 'Get page',
			readOnlyHint: true,
			destructiveHint: false
		} as ToolAnnotations,
		async ( { title, content, metadata } ) => handleGetPageTool( title, content, metadata )
	);
}

async function handleGetPageTool(
	title: string, content: ContentFormat, metadata: boolean
): Promise<CallToolResult> {
	if ( content === ContentFormat.none && !metadata ) {
		return {
			content: [ {
				type: 'text',
				text: 'When content is set to "none", metadata must be true'
			} ],
			isError: true
		};
	}

	try {
		const results: TextContent[] = [];

		// Fetch metadata if requested or needed for "none" content
		if ( metadata || content === ContentFormat.none ) {
			const metaData = await makeActionApiRequest<ActionApiQueryResponse>( {
				action: 'query',
				titles: title,
				prop: 'info|revisions'
			} );

			const pages = metaData.query?.pages || {};
			const page = Object.values( pages )[ 0 ];

			if ( page?.missing !== undefined ) {
				throw new Error( `Page "${ title }" not found` );
			}

			results.push( {
				type: 'text',
				text: [
					`Page ID: ${ page.pageid }`,
					`Title: ${ page.title }`,
					`Latest revision ID: ${ page.lastrevid }`,
					`Latest revision timestamp: ${ page.revisions?.[ 0 ]?.timestamp ?? 'Not available' }`,
					`Content model: ${ page.contentmodel }`
				].join( '\n' )
			} );
		}

		// Fetch source (wikitext)
		if ( content === ContentFormat.source ) {
			const parseData = await makeActionApiRequest<ActionApiParseResponse>( {
				action: 'parse',
				page: title,
				prop: 'wikitext'
			} );

			if ( parseData.error ) {
				throw new Error( parseData.error.info );
			}

			const source = parseData.parse?.wikitext?.[ '*' ] ?? 'Not available';
			if ( metadata ) {
				results.push( { type: 'text', text: `Source:\n${ source }` } );
			} else {
				return { content: [ { type: 'text', text: source } ] };
			}
		}

		// Fetch HTML
		if ( content === ContentFormat.html ) {
			const parseData = await makeActionApiRequest<ActionApiParseResponse>( {
				action: 'parse',
				page: title,
				prop: 'text'
			} );

			if ( parseData.error ) {
				throw new Error( parseData.error.info );
			}

			const html = parseData.parse?.text?.[ '*' ] ?? 'Not available';
			if ( metadata ) {
				results.push( { type: 'text', text: `HTML:\n${ html }` } );
			} else {
				return { content: [ { type: 'text', text: html } ] };
			}
		}

		return { content: results };
	} catch ( error ) {
		return {
			content: [
				{ type: 'text', text: `Failed to retrieve page data: ${ ( error as Error ).message }` } as TextContent
			],
			isError: true
		};
	}
}
