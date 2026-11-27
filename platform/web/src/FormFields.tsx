// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phần vẽ trường của thành phần biểu mẫu, dùng chung cho trang biểu mẫu trên menu (FormPanel.tsx) và biểu mẫu mở từ
// danh mục (CatalogForm.tsx): rjsf với bộ kiểm formValidator, ô danh sách chọn SourceChoice, lỗi tiếng Việt. Nơi gọi
// giữ giá trị và quyết định gửi đi đâu; phần nút gửi đến qua children.

import { Form as MantineForm } from "@rjsf/mantine";
import type { RJSFValidationError } from "@rjsf/utils";
import { type ReactNode, useMemo } from "react";
import { clearDependents, type FormConfig, formRole, formSchema, type Values } from "./formConfig";
import { formValidator } from "./formValidator";
import { type FormContext, SourceChoice } from "./SourceChoice";

// Ô nhập của Mantine đã tự hiện lỗi dưới ô; danh sách lỗi riêng của rjsf dưới mỗi trường sẽ lặp lại cùng lỗi đó.
const NoFieldErrorList = () => null;
const TEMPLATES = { FieldErrorTemplate: NoFieldErrorList };
const WIDGETS = { sourceChoice: SourceChoice };

// Ô đánh dấu bắt buộc mang luật const: true; thông điệp chung "Giá trị không đúng" không nói phải làm gì.
const transformErrors = (errors: RJSFValidationError[]) =>
  errors.map((error) => (error.name === "const" ? { ...error, message: "Cần đánh dấu ô này" } : error));

type Props = {
  config: FormConfig;
  values: Values;
  onValues: (update: (previous: Values) => Values) => void;
  onSubmit: (data: Values) => void;
  children: ReactNode;
};

export function FormFields({ config, values, onValues, onSubmit, children }: Props) {
  const { schema, uiSchema } = useMemo(() => formSchema(config), [config]);
  const context: FormContext = { values, role: formRole(config) };
  return (
    <MantineForm
      schema={schema}
      uiSchema={uiSchema}
      formData={values}
      formContext={context}
      validator={formValidator}
      widgets={WIDGETS}
      templates={TEMPLATES}
      transformErrors={transformErrors}
      onChange={(event) => onValues((previous) => clearDependents(config, previous, event.formData ?? {}))}
      onSubmit={(event) => onSubmit(event.formData ?? {})}
      showErrorList={false}
      noHtml5Validate
    >
      {children}
    </MantineForm>
  );
}
