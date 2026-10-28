import { parseNetText } from '@pnm/core';
import type { DomainView } from '@pnm/domain';
import parcelCenter from '../../../examples/parcel-center.pn.json';
import smartOffice from '../../../examples/smart-office.pn.json';
import type { PromptExample } from './prompt';

function exampleOf(source: unknown): PromptExample {
  const net = parseNetText(JSON.stringify(source));
  return { net, view: net.domainView as DomainView };
}

/** The two worked examples of the prompt: the parcel center and the smart office. */
export function defaultExamples(): PromptExample[] {
  return [exampleOf(parcelCenter), exampleOf(smartOffice)];
}
