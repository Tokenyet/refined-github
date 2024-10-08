import React from 'dom-chef';
import {CachedFunction} from 'webext-storage-cache';
import {isFirefox} from 'webext-detect';
import * as pageDetect from 'github-url-detection';
import AlertIcon from 'octicons-plain-react/Alert';
import GitPullRequestIcon from 'octicons-plain-react/GitPullRequest';
import {expectElement as $} from 'select-dom';

import features from '../feature-manager.js';
import api from '../github-helpers/api.js';
import getDefaultBranch from '../github-helpers/get-default-branch.js';
import {buildRepoURL, cacheByRepo, fixFileHeaderOverlap} from '../github-helpers/index.js';
import GitHubFileURL from '../github-helpers/github-file-url.js';
import observe from '../helpers/selector-observer.js';
import listPrsForFileQuery from './list-prs-for-file.gql';

function getPRUrl(prNumber: number): string {
	// https://caniuse.com/url-scroll-to-text-fragment
	const hash = isFirefox() ? '' : `#:~:text=${new GitHubFileURL(location.href).filePath}`;
	return buildRepoURL('pull', prNumber, 'files') + hash;
}

function getHovercardUrl(prNumber: number): string {
	return buildRepoURL('pull', prNumber, 'hovercard');
}

function getDropdown(prs: number[]): HTMLElement {
	const isEditing = pageDetect.isEditingFile();
	const icon = isEditing
		? <AlertIcon className="color-fg-attention" />
		: <GitPullRequestIcon />;

	// TODO: use Popover API when hovercards become compatible #7496
	return (
		<details className="dropdown details-reset">
			<summary className="Button Button--secondary color-fg-muted">
				{icon}
				<span className="color-fg-default mx-1">{prs.length}</span>
				<div className="dropdown-caret" />
			</summary>

			<details-menu className="dropdown-menu dropdown-menu-sw" style={{width: '180px'}}>
				<div className="px-3 pt-2 h6 color-fg-muted">
					File also being edited in
				</div>
				<ul className="ActionListWrap ActionListWrap--inset">
					{prs.map(prNumber => (
						<li className="ActionListItem">
							<a
								className="ActionListContent"
								href={getPRUrl(prNumber)}
								data-hovercard-url={getHovercardUrl(prNumber)}
							>
								#{prNumber}
							</a>
						</li>
					))}
				</ul>
			</details-menu>
		</details>
	);
}

/**
@returns prsByFile {"filename1": [10, 3], "filename2": [2]}
*/
const getPrsByFile = new CachedFunction('files-with-prs', {
	async updater(): Promise<Record<string, number[]>> {
		const {repository} = await api.v4(listPrsForFileQuery, {
			variables: {
				defaultBranch: await getDefaultBranch(),
			},
		});

		const files: Record<string, number[]> = {};

		for (const pr of repository.pullRequests.nodes) {
			for (const {path} of pr.files.nodes) {
				files[path] ??= [];
				if (files[path].length < 10) {
					files[path].push(pr.number);
				}
			}
		}

		return files;
	},
	maxAge: {hours: 2},
	staleWhileRevalidate: {days: 9},
	cacheKey: cacheByRepo,
});

async function addToSingleFile(moreFileActionsDropdown: HTMLElement): Promise<void> {
	const path = new GitHubFileURL(location.href).filePath;
	const prsByFile = await getPrsByFile.get();
	const prs = prsByFile[path];

	if (prs) {
		const dropdown = getDropdown(prs);
		if (!moreFileActionsDropdown.parentElement!.matches('.gap-2')) {
			dropdown.classList.add('mr-2');
		}

		moreFileActionsDropdown.before(dropdown);

		fixFileHeaderOverlap(moreFileActionsDropdown);
	}
}

async function addToEditingFile(saveButton: HTMLElement): Promise<false | void> {
	const path = new GitHubFileURL(location.href).filePath;
	const prsByFile = await getPrsByFile.get();
	let prs = prsByFile[path];

	if (!prs) {
		return;
	}

	const editingPRNumber = new URLSearchParams(location.search).get('pr')?.split('/').slice(-1);
	if (editingPRNumber) {
		prs = prs.filter(pr => pr !== Number(editingPRNumber));
		if (prs.length === 0) {
			return;
		}
	}

	const dropdown = getDropdown(prs);
	dropdown.classList.add('mr-2');

	// Due to https://github.com/refined-github/refined-github/issues/6579
	$('.dropdown-menu-sw', dropdown).classList.replace('dropdown-menu-sw', 'dropdown-menu-se');

	saveButton.parentElement!.prepend(dropdown);

	fixFileHeaderOverlap(saveButton);
}

function initSingleFile(signal: AbortSignal): void {
	observe('[aria-label="More file actions"]', addToSingleFile, {signal});
}

function initEditingFile(signal: AbortSignal): void {
	observe('[data-hotkey="Mod+s"]', addToEditingFile, {signal});
}

void features.add(import.meta.url, {
	include: [
		pageDetect.isSingleFile,
	],
	init: initSingleFile,
}, {
	include: [
		pageDetect.isEditingFile,
	],
	awaitDomReady: true, // End of the page; DOM-based detections
	init: initEditingFile,
});

/*

## Test URLs

- isSingleFile: One PR https://github.com/refined-github/sandbox/blob/6619/6619
- isSingleFile: Multiple PRs https://github.com/refined-github/sandbox/blob/default-a/README.md
- isEditingFile: One PR https://github.com/refined-github/sandbox/edit/6619/6619
- isEditingFile: Multiple PRs https://github.com/refined-github/sandbox/edit/default-a/README.md

*/
