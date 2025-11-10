/**
 * Content processing utilities for guardrails.
 * 
 * Provides centralized logic for content type detection, text extraction,
 * and message filtering for guardrail processing.
 */

import { Message, ContentPart, TextContentPart, TextOnlyMessageArray } from '../types';

export const TEXT_CONTENT_TYPES = ['input_text', 'text', 'output_text', 'summary_text'] as const;
const TEXT_CONTENT_TYPES_SET = new Set<string>(TEXT_CONTENT_TYPES);

export class ContentUtils {
  /**
   * Check if a content part is text-based.
   */
  static isText(part: ContentPart): boolean {
    return typeof part.type === 'string' && TEXT_CONTENT_TYPES_SET.has(part.type);
  }
  
  /**
   * Extract text from a message.
   */
  static extractTextFromMessage(message: Message): string {
    if (typeof message.content === 'string') {
      return message.content.trim();
    }
    
    if (Array.isArray(message.content)) {
      return message.content
        .filter(part => this.isText(part))
        .map(part => (part as TextContentPart).text)
        .join(' ')
        .trim();
    }
    
    return '';
  }
  
  /**
   * Filter messages to text-only (for guardrails).
   * 
   * Guardrails only work with text content, so this filters out
   * messages that don't contain any text parts.
   */
  static filterToTextOnly(messages: Message[]): TextOnlyMessageArray {
    return messages
      .filter(msg => this.hasTextContent(msg))
      .map(msg => ({
        role: msg.role,
        content: msg.content as string | TextContentPart[]
      }));
  }
  
  /**
   * Check if a message has text content.
   */
  private static hasTextContent(message: Message): boolean {
    if (typeof message.content === 'string') {
      return true;
    }
    
    if (Array.isArray(message.content)) {
      return message.content.some(part => this.isText(part));
    }
    
    return false;
  }
  
}
