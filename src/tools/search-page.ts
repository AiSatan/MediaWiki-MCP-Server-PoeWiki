// TODO: Make tools into an interface
import { z } from 'zod';
/* eslint-disable n/no-missing-import */
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, TextContent, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
/* eslint-enable n/no-missing-import */
import { wikiService } from '../common/wikiService.js';
import { makeActionApiRequest } from '../common/utils.js';

interface ActionApiSearchResult {
	ns: number;
	title: string;
	pageid: number;
	snippet?: string;
	timestamp?: string;
}

interface ActionApiSearchResponse {
	query?: {
		search?: ActionApiSearchResult[];
	};
}

export function searchPageTool( server: McpServer ): RegisteredTool {
	// TODO: Not having named parameters is a pain,
	// but using low-level Server type or using a wrapper function are addedd complexity
	return server.tool(
		'search-page',
		'Search wiki page titles and contents for the provided search terms, and returns matching pages.',
		{
			query: z.string().describe( 'Search terms' ),
			limit: z.number().int().min( 1 ).max( 100 ).optional().describe( 'Maximum number of search results to return' )
		},
		{
			title: 'Search page',
			readOnlyHint: true,
			destructiveHint: false
		} as ToolAnnotations,
		async ( { query, limit } ) => handleSearchPageTool( query, limit )
	);
}

async function handleSearchPageTool( query: string, limit?: number ): Promise< CallToolResult > {
	let data: ActionApiSearchResponse;
	try {
		data = await makeActionApiRequest<ActionApiSearchResponse>( {
			action: 'query',
			list: 'search',
			srsearch: query,
			...( limit ? { srlimit: limit.toString() } : {} )
		} );
	} catch ( error ) {
		return {
			content: [
				{ type: 'text', text: `Failed to retrieve search data: ${ ( error as Error ).message }` } as TextContent
			],
			isError: true
		};
	}

	const pages = data.query?.search || [];
	if ( pages.length === 0 ) {
		return {
			content: [
				{ type: 'text', text: `No pages found for ${ query }` } as TextContent
			]
		};
	}

	return {
		content: pages.map( getSearchResultToolResult )
	};
}

// TODO: Decide how to handle the tool's result
function getSearchResultToolResult( result: ActionApiSearchResult ): TextContent {
	const { server, articlepath } = wikiService.getCurrent().config;
	// Strip HTML tags from snippet
	const snippet = ( result.snippet || '' ).replace( /<[^>]*>/g, '' );
	return {
		type: 'text',
		text: [
			`Title: ${ result.title }`,
			`Description: ${ snippet }`,
			`Page ID: ${ result.pageid }`,
			`Page URL: ${ `${ server }${ articlepath }/${ encodeURIComponent( result.title ) }` }`
		].join( '\n' )
	};
}
