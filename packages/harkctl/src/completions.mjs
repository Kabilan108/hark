const GROUPS = [
  "auth",
  "notify",
  "interaction",
  "activity",
  "permissions",
  "devices",
  "services",
  "projects",
  "skill",
  "completions",
];

const ACTIONS = {
  auth: ["login", "logout", "status"],
  notify: ["ask"],
  interaction: ["get", "wait"],
  activity: ["start", "update", "end", "get", "list"],
  permissions: ["setup", "uninstall", "doctor", "help"],
  devices: ["list"],
  services: ["list", "create"],
  projects: ["list", "rename", "archive", "unarchive", "move"],
  skill: ["services", "list", "help"],
  completions: ["bash", "zsh", "fish"],
};

const FLAGS = {
  "auth login": [
    "--client-name", "--scope", "--expires-in", "--timeout", "--open", "--no-open",
  ],
  notify: [
    "--title", "--image", "--url", "--device", "--project", "--summary", "--markdown",
    "--body-format", "--idempotency-key", "--stdin",
  ],
  "notify ask": [
    "--approval", "--yes-no", "--text", "--title", "--image", "--url", "--device",
    "--project", "--expires-in", "--live-activity", "--style", "--primary-label",
    "--secondary-label", "--idempotency-key", "--stdin", "--wait", "--timeout", "--poll",
  ],
  "interaction wait": ["--timeout"],
  "activity start": [
    "--title", "--status", "--key", "--detail", "--progress", "--symbol", "--privacy",
    "--style", "--accent-color", "--device", "--expires-in", "--stale-after", "--project",
    "--replace", "--idempotency-key", "--stdin",
  ],
  "activity update": [
    "--title", "--status", "--detail", "--progress", "--symbol", "--privacy",
    "--style", "--accent-color", "--stale-after", "--if-sequence", "--idempotency-key", "--stdin",
  ],
  "activity end": [
    "--status", "--detail", "--progress", "--symbol", "--accent-color",
    "--dismiss-after", "--if-sequence", "--idempotency-key", "--stdin",
  ],
  "activity list": ["--limit"],
  "services create": ["--title", "--image", "--url", "--stdin"],
  "projects list": ["--archived"],
  "projects move": ["--kind", "--project", "--unfiled"],
};

const VALUES = {
  "--archived": ["exclude", "include", "only"],
  "--body-format": ["text", "markdown"],
  "--kind": ["event", "notification", "interaction", "activity"],
  "--privacy": ["standard", "private"],
};

function words(values) {
  return values.join(" ");
}

export function bashCompletion() {
  const cases = Object.entries(ACTIONS)
    .map(([key, values]) => `      ${key}) candidates="${words(values)}" ;;`)
    .join("\n");
  const flags = Object.entries(FLAGS)
    .map(([key, values]) => `      '${key}') candidates="${words(values)}" ;;`)
    .join("\n");
  const values = Object.entries(VALUES)
    .map(([key, entries]) => `      ${key}) candidates="${words(entries)}" ;;`)
    .join("\n");
  return `# bash completion for harkctl
_harkctl() {
  local current previous group action candidates
  COMPREPLY=()
  current="\${COMP_WORDS[COMP_CWORD]}"
  previous="\${COMP_WORDS[COMP_CWORD-1]}"
  group="\${COMP_WORDS[1]}"
  action="\${COMP_WORDS[2]}"

  case "$previous" in
    --style)
      case "$group $action" in
        'notify ask') candidates="approval shell verdict signal" ;;
        'activity start'|'activity update') candidates="standard ring hero terminal steps" ;;
      esac
      ;;
${values}
  esac
  if [[ -n "$candidates" ]]; then
    COMPREPLY=( $(compgen -W "$candidates" -- "$current") )
    return
  fi

  if [[ $COMP_CWORD -eq 1 ]]; then
    candidates="${words(GROUPS)} --help"
  elif [[ $COMP_CWORD -eq 2 ]]; then
    case "$group" in
${cases}
    esac
  fi

  if [[ "$current" == --* ]]; then
    case "$group $action" in
${flags}
      'notify '*) candidates="${words(FLAGS.notify)}" ;;
      *) candidates="" ;;
    esac
    candidates="$candidates --help"
  fi
  COMPREPLY=( $(compgen -W "$candidates" -- "$current") )
}
complete -F _harkctl harkctl
`;
}

export function zshCompletion() {
  const actions = Object.entries(ACTIONS)
    .map(([key, values]) => `      ${key}) _values 'action' ${words(values)} ;;`)
    .join("\n");
  const flags = Object.entries(FLAGS)
    .map(([key, values]) => `      '${key}') _values 'option' ${words(values)} ;;`)
    .join("\n");
  const values = Object.entries(VALUES)
    .map(([key, entries]) => `    ${key}) _values 'value' ${words(entries)}; return ;;`)
    .join("\n");
  return `#compdef harkctl
_harkctl() {
  local group="\${words[2]}" action="\${words[3]}" previous="\${words[CURRENT-1]}"
  case "$previous" in
    --style)
      case "$group $action" in
        'notify ask') _values 'style' approval shell verdict signal ;;
        'activity start'|'activity update') _values 'style' standard ring hero terminal steps ;;
      esac
      return
      ;;
${values}
  esac
  if (( CURRENT == 2 )); then
    _values 'command' ${words(GROUPS)}
  elif [[ "\${PREFIX}" == --* ]]; then
    case "$group $action" in
${flags}
      'notify '*) _values 'option' ${words(FLAGS.notify)} --help ;;
      *) _values 'option' --help ;;
    esac
  elif (( CURRENT == 3 )); then
    case "$group" in
${actions}
    esac
  fi
}
compdef _harkctl harkctl
`;
}

function fishLine(command, values, options = "") {
  return `complete -c harkctl -f -n '${command}' ${options}-a '${words(values)}'`;
}

export function fishCompletion() {
  const lines = [
    "# fish completion for harkctl",
    fishLine("__fish_use_subcommand", GROUPS),
    "complete -c harkctl -l help",
  ];
  for (const [group, actions] of Object.entries(ACTIONS)) {
    lines.push(fishLine(`__fish_seen_subcommand_from ${group}; and not __fish_seen_subcommand_from ${words(actions)}`, actions));
  }
  for (const [key, flags] of Object.entries(FLAGS)) {
    const [group, action] = key.split(" ");
    const condition = action
      ? `__fish_seen_subcommand_from ${group}; and __fish_seen_subcommand_from ${action}`
      : group === "notify"
        ? "__fish_seen_subcommand_from notify; and not __fish_seen_subcommand_from ask"
        : `__fish_seen_subcommand_from ${group}`;
    for (const flag of flags) {
      lines.push(`complete -c harkctl -f -n '${condition}' -l ${flag.slice(2)}`);
    }
  }
  for (const [flag, values] of Object.entries(VALUES)) {
    lines.push(`complete -c harkctl -f -n '__fish_prev_arg_in ${flag}' -a '${words(values)}'`);
  }
  lines.push("complete -c harkctl -f -n '__fish_prev_arg_in --style; and __fish_seen_subcommand_from ask' -a 'approval shell verdict signal'");
  lines.push("complete -c harkctl -f -n '__fish_prev_arg_in --style; and __fish_seen_subcommand_from start update' -a 'standard ring hero terminal steps'");
  return `${lines.join("\n")}\n`;
}

export function completionFor(shell) {
  if (shell === "bash") return bashCompletion();
  if (shell === "zsh") return zshCompletion();
  if (shell === "fish") return fishCompletion();
  throw new Error(`Unsupported shell: ${shell}`);
}
