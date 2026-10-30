import { RiDeleteBinLine } from '@remixicon/react';
import {
  type ChangeEvent,
  type ClipboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Button } from '#/client/components/button';
import { FormItem } from '#/client/components/form-item';
import { Modal } from '#/client/components/modal';
import { useI18n } from '#/client/i18n';
import { MAX_IMAGE_BYTES } from '#/limits';

import { type InkyComponentType, INKY_COMPONENTS } from './components';

import '../style.css';
import './style.css';

function classNames(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export interface InkyMenuItem {
  text: string;
  href: string;
}

export interface InkyComponentResult {
  type: InkyComponentType;
  attrs: Record<string, string>;
  text: string;
  items?: InkyMenuItem[];
  file?: File;
  previewUrl?: string;
}

export interface InkyComponentDialogProps {
  type: InkyComponentType;
  onSubmit: (result: InkyComponentResult) => void;
  onDismiss: () => void;
}

function inputValue(
  values: Record<string, string>,
  setValues: (next: Record<string, string>) => void,
  name: string,
) {
  return {
    value: values[name] ?? '',
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValues({ ...values, [name]: event.target.value }),
  };
}

function checkboxValue(
  values: Record<string, string>,
  setValues: (next: Record<string, string>) => void,
  name: string,
) {
  return {
    checked: values[name] === 'true',
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      setValues({ ...values, [name]: event.target.checked ? 'true' : '' }),
  };
}

export function InkyComponentDialog({
  type,
  onSubmit,
  onDismiss,
}: InkyComponentDialogProps) {
  const { t } = useI18n();
  const definition = INKY_COMPONENTS[type];
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [fileError, setFileError] = useState('');
  const [menuItems, setMenuItems] = useState<InkyMenuItem[]>(() =>
    type === 'menu' ? [{ text: t('compose.link'), href: '' }] : [],
  );
  const [values, setValues] = useState<Record<string, string>>(
    (): Record<string, string> => {
      if (type === 'button') {
        return {
          text: t('compose.componentButton'),
          size: 'small',
          color: 'primary',
        };
      }

      if (type === 'badge') {
        return {
          text: t('compose.componentBadge'),
          color: '#333333',
          'text-color': '#ffffff',
        };
      }

      if (type === 'callout') {
        return { text: t('compose.componentCallout'), color: 'primary' };
      }

      if (type === 'alert') {
        return { text: t('compose.componentAlert'), type: 'info' };
      }

      if (type === 'blockquote') {
        return { text: t('compose.componentBlockquote') };
      }

      if (type === 'preview') {
        return { text: t('compose.componentPreview') };
      }

      if (type === 'menu') {
        return { align: 'center' };
      }
      return {};
    },
  );

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const selectFile = (selected: File | null) => {
    if (!selected) {
      return;
    }

    if (!selected.type.startsWith('image/')) {
      setFileError(t('compose.imageUploadFailed'));

      return;
    }

    if (selected.size > MAX_IMAGE_BYTES) {
      setFileError(t('compose.imageTooLarge'));

      return;
    }

    setFileError('');
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
    setValues(current => ({ ...current, src: '' }));
  };

  const pasteFile = (event: ClipboardEvent<HTMLDivElement>) => {
    const item = Array.from(event.clipboardData.items).find(item =>
      item.type.startsWith('image/'),
    );
    const selected = item?.getAsFile() ?? event.clipboardData.files[0];

    if (!selected) {
      return;
    }
    event.preventDefault();
    selectFile(selected);
  };

  const submit = () => {
    const attrs: Record<string, string> = {};

    for (const [name, value] of Object.entries(values)) {
      if (name === 'text' || !value.trim()) {
        continue;
      }
      attrs[name] = value === 'true' ? '' : value;
    }

    if (type === 'button') {
      const modifiers = ['rounded', 'hollow', 'expand']
        .filter(name => attrs[name] === '')
        .join(' ');

      delete attrs.rounded;
      delete attrs.hollow;
      delete attrs.expand;

      if (modifiers) {
        attrs.class = classNames(attrs.class, modifiers);
      }
    }

    onSubmit({
      type,
      attrs,
      text: values.text ?? '',
      items:
        type === 'menu'
          ? menuItems.map(item => ({
              text: item.text.trim(),
              href: item.href.trim(),
            }))
          : undefined,
      file: file ?? undefined,
      previewUrl: previewUrl || undefined,
    });
  };

  const textLabel = t('compose.linkText');
  const urlLabel = t('compose.linkUrl');

  return (
    <Modal
      title={t(definition.label)}
      onDismiss={onDismiss}
      footer={
        <>
          <Button onClick={onDismiss}>{t('ui.cancel')}</Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={
              (type === 'image' && !file && !(values.src ?? '').trim()) ||
              (type === 'menu' &&
                !menuItems.some(item => item.text.trim() || item.href.trim()))
            }
          >
            {t('compose.insert')}
          </Button>
        </>
      }
    >
      <div className="inky-component-form" onPaste={pasteFile}>
        {type === 'button' ? (
          <>
            <FormItem label={textLabel}>
              <input autoFocus {...inputValue(values, setValues, 'text')} />
            </FormItem>
            <FormItem label={urlLabel}>
              <input {...inputValue(values, setValues, 'href')} />
            </FormItem>
            <FormItem label={t('compose.attrTarget')}>
              <input
                placeholder="_blank"
                {...inputValue(values, setValues, 'target')}
              />
            </FormItem>
            <FormItem label={t('compose.attrSize')}>
              <select {...inputValue(values, setValues, 'size')}>
                <option value="tiny">{t('compose.optionTiny')}</option>
                <option value="small">{t('compose.optionSmall')}</option>
                <option value="large">{t('compose.optionLarge')}</option>
              </select>
            </FormItem>
            <FormItem label={t('compose.attrColor')}>
              <select {...inputValue(values, setValues, 'color')}>
                <option value="primary">{t('compose.optionPrimary')}</option>
                <option value="secondary">
                  {t('compose.optionSecondary')}
                </option>
                <option value="success">{t('compose.optionSuccess')}</option>
                <option value="alert">{t('compose.optionAlert')}</option>
                <option value="warning">{t('compose.optionWarning')}</option>
              </select>
            </FormItem>
            <div className="inky-component-checks">
              <label className="inky-component-check">
                <input
                  type="checkbox"
                  {...checkboxValue(values, setValues, 'rounded')}
                />
                {t('compose.attrRounded')}
              </label>
              <label className="inky-component-check">
                <input
                  type="checkbox"
                  {...checkboxValue(values, setValues, 'hollow')}
                />
                {t('compose.attrHollow')}
              </label>
              <label className="inky-component-check">
                <input
                  type="checkbox"
                  {...checkboxValue(values, setValues, 'expand')}
                />
                {t('compose.attrExpand')}
              </label>
            </div>
          </>
        ) : null}

        {type === 'badge' ? (
          <>
            <FormItem label={textLabel}>
              <input autoFocus {...inputValue(values, setValues, 'text')} />
            </FormItem>
            <FormItem label={t('compose.attrColor')}>
              <input {...inputValue(values, setValues, 'color')} />
            </FormItem>
            <FormItem label={t('compose.attrTextColor')}>
              <input {...inputValue(values, setValues, 'text-color')} />
            </FormItem>
          </>
        ) : null}

        {type === 'callout' ? (
          <>
            <FormItem label={textLabel}>
              <input autoFocus {...inputValue(values, setValues, 'text')} />
            </FormItem>
            <FormItem label={t('compose.attrColor')}>
              <select {...inputValue(values, setValues, 'color')}>
                <option value="primary">{t('compose.optionPrimary')}</option>
                <option value="secondary">
                  {t('compose.optionSecondary')}
                </option>
                <option value="success">{t('compose.optionSuccess')}</option>
                <option value="alert">{t('compose.optionAlert')}</option>
                <option value="warning">{t('compose.optionWarning')}</option>
              </select>
            </FormItem>
          </>
        ) : null}

        {type === 'alert' ? (
          <>
            <FormItem label={textLabel}>
              <input autoFocus {...inputValue(values, setValues, 'text')} />
            </FormItem>
            <FormItem label={t('compose.attrType')}>
              <select {...inputValue(values, setValues, 'type')}>
                <option value="info">{t('compose.optionInfo')}</option>
                <option value="success">{t('compose.optionSuccess')}</option>
                <option value="warning">{t('compose.optionWarning')}</option>
                <option value="error">{t('compose.optionError')}</option>
              </select>
            </FormItem>
            <FormItem label={t('compose.attrColor')}>
              <input {...inputValue(values, setValues, 'color')} />
            </FormItem>
          </>
        ) : null}

        {type === 'blockquote' ? (
          <>
            <FormItem label={textLabel}>
              <input autoFocus {...inputValue(values, setValues, 'text')} />
            </FormItem>
            <FormItem label={t('compose.attrCite')}>
              <input {...inputValue(values, setValues, 'cite')} />
            </FormItem>
            <FormItem label={t('compose.attrColor')}>
              <input {...inputValue(values, setValues, 'color')} />
            </FormItem>
          </>
        ) : null}

        {type === 'image' ? (
          <>
            <div className="inky-image-upload">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={event => {
                  const selected = event.target.files?.[0] ?? null;

                  event.target.value = '';
                  selectFile(selected);
                }}
              />
              <button
                type="button"
                className="inky-image-drop"
                onClick={() => fileRef.current?.click()}
                onDragOver={event => event.preventDefault()}
                onDrop={event => {
                  event.preventDefault();
                  selectFile(event.dataTransfer.files[0] ?? null);
                }}
              >
                {previewUrl ? (
                  <img src={previewUrl} alt="" />
                ) : (
                  <span>{t('compose.imageUpload')}</span>
                )}
              </button>
              {previewUrl ? (
                <button
                  type="button"
                  className="inky-image-clear"
                  onClick={() => {
                    setFile(null);
                    setPreviewUrl('');
                    setFileError('');
                  }}
                >
                  {t('mail.delete')}
                </button>
              ) : null}
            </div>
            {fileError ? (
              <p className="inky-image-error" role="alert">
                {fileError}
              </p>
            ) : null}
            <FormItem label={urlLabel}>
              <input
                autoFocus={!previewUrl}
                disabled={Boolean(previewUrl)}
                {...inputValue(values, setValues, 'src')}
              />
            </FormItem>
            <FormItem label={t('compose.attrAlt')}>
              <input {...inputValue(values, setValues, 'alt')} />
            </FormItem>
            <FormItem label={t('compose.attrWidth')}>
              <input
                inputMode="numeric"
                {...inputValue(values, setValues, 'width')}
              />
            </FormItem>
            <div className="inky-component-checks">
              <label className="inky-component-check">
                <input
                  type="checkbox"
                  {...checkboxValue(values, setValues, 'retina')}
                />
                {t('compose.attrRetina')}
              </label>
            </div>
          </>
        ) : null}

        {type === 'video' ? (
          <>
            <FormItem label={urlLabel}>
              <input autoFocus {...inputValue(values, setValues, 'src')} />
            </FormItem>
            <FormItem label={t('compose.attrPoster')}>
              <input {...inputValue(values, setValues, 'poster')} />
            </FormItem>
            <FormItem label={t('compose.attrAlt')}>
              <input {...inputValue(values, setValues, 'alt')} />
            </FormItem>
            <FormItem label={t('compose.attrWidth')}>
              <input
                inputMode="numeric"
                {...inputValue(values, setValues, 'width')}
              />
            </FormItem>
            <FormItem label={urlLabel}>
              <input {...inputValue(values, setValues, 'href')} />
            </FormItem>
          </>
        ) : null}

        {type === 'menu' ? (
          <>
            <div className="inky-menu-items">
              {menuItems.map((item, index) => (
                <div className="inky-menu-item" key={index}>
                  <div className="inky-menu-item-fields">
                    <FormItem label={textLabel}>
                      <input
                        autoFocus={index === 0}
                        value={item.text}
                        onChange={event =>
                          setMenuItems(current =>
                            current.map((entry, entryIndex) =>
                              entryIndex === index
                                ? { ...entry, text: event.target.value }
                                : entry,
                            ),
                          )
                        }
                      />
                    </FormItem>
                    <FormItem label={urlLabel}>
                      <input
                        value={item.href}
                        onChange={event =>
                          setMenuItems(current =>
                            current.map((entry, entryIndex) =>
                              entryIndex === index
                                ? { ...entry, href: event.target.value }
                                : entry,
                            ),
                          )
                        }
                      />
                    </FormItem>
                  </div>
                  <Button
                    variant="icon"
                    aria-label={t('compose.removeMenuItem')}
                    disabled={menuItems.length === 1}
                    onClick={() =>
                      setMenuItems(current =>
                        current.filter((_, entryIndex) => entryIndex !== index),
                      )
                    }
                  >
                    <RiDeleteBinLine size={18} aria-hidden />
                  </Button>
                </div>
              ))}
            </div>
            <div className="inky-menu-add">
              <Button
                onClick={() =>
                  setMenuItems(current => [...current, { text: '', href: '' }])
                }
              >
                {t('compose.addMenuItem')}
              </Button>
            </div>
            <FormItem label={t('compose.attrAlign')}>
              <select {...inputValue(values, setValues, 'align')}>
                <option value="center">{t('compose.optionCenter')}</option>
                <option value="">{t('compose.optionLeft')}</option>
                <option value="right">{t('compose.optionRight')}</option>
              </select>
            </FormItem>
            <FormItem label={t('compose.attrDirection')}>
              <select {...inputValue(values, setValues, 'direction')}>
                <option value="">{t('compose.optionHorizontal')}</option>
                <option value="vertical">{t('compose.optionVertical')}</option>
              </select>
            </FormItem>
          </>
        ) : null}

        {type === 'preview' ? (
          <FormItem label={textLabel}>
            <input autoFocus {...inputValue(values, setValues, 'text')} />
          </FormItem>
        ) : null}
      </div>
    </Modal>
  );
}
