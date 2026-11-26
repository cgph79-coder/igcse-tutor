/** Registry of available syllabuses. Add a line here when you add a subject file. */
import addMaths from "./cambridge-0606.json";
import coSci from "./cambridge-0973.json";
import compSci from "./cambridge-0984.json";
import history from "./cambridge-0977.json";

export interface Topic {
  id: string;
  title: string;
  subtopics: string[];
  extended?: string[];
  tier?: "extended";
  verify?: boolean;
}

export interface Section {
  id: string;
  title: string;
  topics: Topic[];
}

export interface Syllabus {
  board: string;
  boardName: string;
  code: string;
  subject: string;
  grading: string;
  tiers: string[] | null;
  defaultTier: string | null;
  notes: string;
  verify?: boolean;
  sections: Section[];
}

export const SYLLABUSES: Syllabus[] = [addMaths, coSci, compSci, history] as Syllabus[];

export function findSyllabus(code: string): Syllabus | undefined {
  return SYLLABUSES.find((s) => s.code === code);
}

export function findTopic(s: Syllabus, topicId: string): { section: Section; topic: Topic } | undefined {
  for (const section of s.sections) {
    const topic = section.topics.find((t) => t.id === topicId);
    if (topic) return { section, topic };
  }
  return undefined;
}
