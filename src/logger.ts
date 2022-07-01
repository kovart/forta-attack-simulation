/* eslint-disable no-console */

export enum LoggerLevel {
  DEBUG,
  INFO,
  WARN,
  ERROR,
}

export class Logger {
  private scope: any[] = [];
  private level: LoggerLevel;

  public constructor(level = LoggerLevel.INFO, args?: any[]) {
    this.level = level;
    if (args) {
      this.scope.push(...args);
    }
  }

  private _log(args: any[], level: LoggerLevel) {
    if (level < this.level) return;

    console.log(...this.scope, ...args);
  }

  public debug(...args: any[]) {
    this._log(args, LoggerLevel.DEBUG);
  }

  public info(...args: any[]) {
    this._log(args, LoggerLevel.INFO);
  }

  public warn(...args: any[]) {
    this._log(args, LoggerLevel.WARN);
  }

  public error(...args: any[]) {
    this._log(args, LoggerLevel.ERROR);
  }

  public clone(...args: any[]) {
    return new Logger(this.level, [...this.scope, ...args]);
  }
}
