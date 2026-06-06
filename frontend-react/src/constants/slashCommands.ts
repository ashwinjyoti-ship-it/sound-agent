import type { SlashCommand } from '@/types'

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: '/clear',        desc: 'Clear chat history',            prefix: '',                       taskType: 'clear' },
  { cmd: '/add-show',     desc: 'Add a new show',                prefix: 'Add: ',                  taskType: 'Add' },
  { cmd: '/crew',         desc: 'Check crew availability',       prefix: 'Crew: ',                 taskType: 'Crew' },
  { cmd: '/crew-assign',  desc: 'Assign crew to a show',         prefix: 'Assign: ',               taskType: 'Assign' },
  { cmd: '/update-CT',    desc: 'Update call time',              prefix: 'CT: ',                   taskType: 'CT' },
  { cmd: '/update-sound', desc: 'Update sound requirements',     prefix: 'SR: ',                   taskType: 'SR' },
  { cmd: '/update-venue', desc: 'Update venue',                  prefix: 'Venue: ',                taskType: 'Venue' },
  { cmd: '/quote',        desc: 'Generate equipment quote',      prefix: 'Quote — Items: ',        taskType: 'Quote' },
  { cmd: '/day-off',      desc: 'Mark crew day off',             prefix: 'Day-off — Crew: ',       taskType: 'DayOff' },
  { cmd: '/delete-show',  desc: 'Delete a show',                 prefix: 'Delete: ',               taskType: 'Delete' },
  { cmd: '/update-prog',  desc: 'Update programme name',        prefix: 'Programme: ',            taskType: 'Prog' },
]
