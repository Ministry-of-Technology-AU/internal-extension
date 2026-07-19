export type Term = 'monsoon' | 'spring' | 'summer';

export interface Semester {
  /** ScheduleSysGenId — the same id is used by all three AMS pages. */
  id: string;
  label: string;
  term: Term;
  year: number;
}

// Taken from ddlSchedule on CoursePreRequisites_View.aspx. The catalog page also
// carries YSCH* term entries (2025-26 - Term 3 etc.); those are a different
// scheduling scheme and are deliberately excluded.
const RAW: [string, string][] = [
  ['SCH00000039', 'Summer 2027'],
  ['SCH00000038', 'Spring 2027'],
  ['SCH00000037', 'Monsoon 2026'],
  ['SCH00000035', 'Summer 2026'],
  ['SCH00000036', 'Spring 2026'],
  ['SCH00000034', 'Monsoon 2025'],
  ['SCH00000033', 'Summer 2025'],
  ['SCH00000032', 'Spring 2025'],
  ['SCH00000031', 'Monsoon 2024'],
  ['SCH00000030', 'Summer 2024'],
  ['SCH00000029', 'Spring 2024'],
  ['SCH00000028', 'Monsoon 2023'],
  ['SCH00000027', 'Summer 2023'],
  ['SCH00000026', 'Spring 2023'],
  ['SCH00000025', 'Monsoon 2022'],
  ['SCH00000024', 'Summer 2022'],
  ['SCH00000023', 'Spring 2022'],
  ['SCH00000022', 'Monsoon 2021'],
  ['SCH00000021', 'Summer 2021'],
  ['SCH00000020', 'Spring 2021'],
  ['SCH00000019', 'Monsoon 2020'],
  ['SCH00000018', 'Summer 2020'],
  ['SCH00000017', 'Spring 2020'],
  ['SCH00000016', 'Monsoon 2019'],
  ['SCH00000015', 'Summer 2019'],
  ['SCH00000014', 'Spring 2019'],
  ['SCH00000013', 'Monsoon 2018'],
  ['SCH00000012', 'Summer 2018'],
  ['SCH00000011', 'Spring 2018'],
  ['SCH00000010', 'Monsoon 2017'],
  ['SCH00000009', 'Summer 2017'],
  ['SCH00000008', 'Spring 2017'],
  ['SCH00000007', 'Monsoon 2016'],
  ['SCH00000006', 'Summer 2016'],
  ['SCH00000005', 'Spring 2016'],
  ['SCH00000004', 'Monsoon 2015'],
  ['SCH00000003', 'Summer 2015'],
  ['SCH00000002', 'Spring 2015'],
  ['SCH00000001', 'Monsoon 2014'],
];

export const SEMESTERS: Semester[] = RAW.map(([id, label]) => {
  const [term, year] = label.split(' ');
  return { id, label, term: term.toLowerCase() as Term, year: Number(year) };
});

export const semesterById = (id: string): Semester | undefined =>
  SEMESTERS.find((s) => s.id === id);

/** Most recent Monsoon/Spring term, used as the default selection. */
export const DEFAULT_SEMESTER_ID = 'SCH00000037';
