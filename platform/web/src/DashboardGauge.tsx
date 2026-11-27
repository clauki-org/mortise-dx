// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Vòng đo của khối thẻ số trên bảng điều hành (ADR 0049): một vòng đầy là mức `limit`, phần trên 100% là vòng thứ hai
// bên trong. Độ dài vòng chỉ đọc cột phần trăm mà gói tính sẵn (dashboardBento.ts); số gốc value, limit hiện trên thẻ
// cạnh vòng. DashboardView.tsx đặt vòng này cạnh các thẻ của khối. Chữ của vòng lấy từ cấu hình của gói.

import { Box, Stack, Text } from "@mantine/core";
import { gaugeLaps } from "./dashboardBento";
import { type Card, type Gauge, NO_DATA, numberText, type Row } from "./dashboardConfig";

const SIZE = 168;
const STROKE = 14;
const OUTER = (SIZE - STROKE) / 2;
const INNER = OUTER - STROKE - 4;
const ARC = "var(--mantine-primary-color-filled)";
const TRACK = "var(--mantine-color-gray-2)";

/** Một vòng: nền xám rồi cung màu chính dài `lap` vòng, bắt đầu ở đỉnh, theo chiều kim đồng hồ. */
function Ring({ radius, lap }: { radius: number; lap: number }) {
  const length = 2 * Math.PI * radius;
  const center = SIZE / 2;
  return (
    <>
      <circle cx={center} cy={center} r={radius} fill="none" stroke={TRACK} strokeWidth={STROKE} />
      {lap > 0 && (
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={ARC}
          strokeWidth={STROKE}
          strokeDasharray={`${lap * length} ${length}`}
          transform={`rotate(-90 ${center} ${center})`}
        />
      )}
    </>
  );
}

/** Chữ của một số kèm đơn vị của thẻ đọc cùng cột, như trên thẻ. */
function cardText(cards: Card[], column: string, row: Row): string {
  const card = cards.find((candidate) => candidate.column === column);
  const text = numberText(row[column], card?.format);
  return [card?.label, text, card?.unit && text !== NO_DATA ? card.unit : ""].filter(Boolean).join(" ");
}

/**
 * Vòng đo và chữ phần trăm giữa vòng. Trình đọc màn hình đọc một tên gồm nhãn của gói, phần trăm và hai số gốc; phần
 * hình ẩn khỏi nó để số không bị đọc hai lần.
 */
export function GaugeView({ gauge, cards, row }: { gauge: Gauge; cards: Card[]; row: Row }) {
  const laps = gaugeLaps(row[gauge.percent]);
  const percent = laps ? `${numberText(row[gauge.percent])}%` : NO_DATA;
  const name = `${gauge.label}: ${percent}. ${cardText(cards, gauge.value, row)}; ${cardText(cards, gauge.limit, row)}.`;
  return (
    <Stack gap={6} align="center" w={SIZE} style={{ flexShrink: 0 }} role="img" aria-label={name}>
      <Box pos="relative" w={SIZE} h={SIZE} aria-hidden>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="presentation">
          <Ring radius={OUTER} lap={laps?.outer ?? 0} />
          {laps && laps.inner > 0 && <Ring radius={INNER} lap={laps.inner} />}
        </svg>
        <Text
          pos="absolute"
          inset={0}
          fz={laps ? "h2" : "sm"}
          fw={800}
          ta="center"
          style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          {percent}
        </Text>
      </Box>
      <Text size="sm" ta="center" aria-hidden>
        {gauge.label}
      </Text>
    </Stack>
  );
}
