import Phaser from 'phaser';

export class AudioNoticeScene extends Phaser.Scene {
  private inputLocked = false;

  constructor() {
    super('AudioNoticeScene');
  }

  create() {
    const bg = this.add.graphics();
    const panel = this.add.rectangle(0, 0, 100, 100, 0x10151d, 0.84).setOrigin(0.5);
    panel.setStrokeStyle(2, 0x6f7f95, 0.65);

    const icon = this.add.graphics();

    const title = this.add.text(0, 0, '音频体验提示', {
      fontFamily: 'Arial Black',
      fontSize: '56px',
      color: '#f0f3f9',
      stroke: '#000000',
      strokeThickness: 7,
      align: 'center'
    }).setOrigin(0.5);
    title.setPadding(0, 10, 0, 8);

    const advice = this.add.text(0, 0, '佩戴耳机或使用音箱\n获得最好的游戏体验', {
      fontFamily: 'Arial',
      fontSize: '34px',
      color: '#d7dce6',
      fontStyle: 'bold',
      align: 'center',
      lineSpacing: 12
    }).setOrigin(0.5);
    advice.setPadding(0, 8, 0, 8);

    const confirmBg = this.add.rectangle(0, 0, 260, 72, 0x2f4f76, 0.95).setOrigin(0.5);
    confirmBg.setStrokeStyle(2, 0xaec7e6, 0.8);
    confirmBg.setInteractive({ useHandCursor: true });

    const confirmText = this.add.text(0, 0, '确定', {
      fontFamily: 'Arial Black',
      fontSize: '34px',
      color: '#ffffff',
      stroke: '#0c1220',
      strokeThickness: 6
    }).setOrigin(0.5);
    confirmText.setPadding(0, 6, 0, 4);

    const hint = this.add.text(0, 0, '按 Enter / 空格 也可继续', {
      fontFamily: 'Arial',
      fontSize: '18px',
      color: '#8f9db3'
    }).setOrigin(0.5);

    const enterMenu = () => {
      if (this.inputLocked) return;
      this.inputLocked = true;
      this.tweens.killTweensOf([confirmBg, confirmText]);
      this.cameras.main.fade(220, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('MenuScene');
      });
    };

    confirmBg.on('pointerover', () => {
      if (this.inputLocked) return;
      confirmBg.setFillStyle(0x3e6796, 1);
      this.tweens.add({ targets: [confirmBg, confirmText], scaleX: 1.04, scaleY: 1.04, duration: 90, ease: 'Quad.out' });
    });

    confirmBg.on('pointerout', () => {
      confirmBg.setFillStyle(0x2f4f76, 0.95);
      this.tweens.add({ targets: [confirmBg, confirmText], scaleX: 1, scaleY: 1, duration: 90, ease: 'Quad.out' });
    });

    confirmBg.on('pointerdown', enterMenu);

    const onEnter = () => enterMenu();
    this.input.keyboard?.on('keydown-ENTER', onEnter);
    this.input.keyboard?.on('keydown-SPACE', onEnter);

    const layout = () => {
      const w = this.scale.width;
      const h = this.scale.height;
      const unit = Math.max(1, Math.min(w, h));

      bg.clear();
      bg.fillGradientStyle(0x090d13, 0x090d13, 0x030405, 0x030405, 1);
      bg.fillRect(0, 0, w, h);
      bg.fillStyle(0x151f2d, 0.28);
      bg.fillRect(0, h * 0.62, w, h * 0.38);

      panel.setSize(Math.min(w * 0.86, unit * 1.25), Math.min(h * 0.74, unit * 1.0));
      panel.setPosition(w * 0.5, h * 0.5);

      const iconR = Phaser.Math.Clamp(Math.round(unit * 0.072), 28, 52);
      const iconX = w * 0.5;
      const iconY = panel.y - panel.height * 0.31;

      icon.clear();
      icon.lineStyle(Math.max(3, Math.round(iconR * 0.13)), 0xd8dde7, 1);
      icon.beginPath();
      icon.arc(iconX, iconY, iconR, Math.PI, 0, false);
      icon.strokePath();
      icon.fillStyle(0xd8dde7, 1);
      const cupW = Math.max(10, Math.round(iconR * 0.34));
      const cupH = Math.max(18, Math.round(iconR * 0.95));
      const cupR = Math.max(2, Math.round(iconR * 0.12));
      icon.fillRoundedRect(iconX - iconR * 1.18, iconY - iconR * 0.2, cupW, cupH, cupR);
      icon.fillRoundedRect(iconX + iconR * 0.84, iconY - iconR * 0.2, cupW, cupH, cupR);

      title.setFontSize(`${Phaser.Math.Clamp(Math.round(unit * 0.07), 36, 64)}px`);
      title.setPosition(w * 0.5, iconY + iconR * 1.45);

      advice.setFontSize(`${Phaser.Math.Clamp(Math.round(unit * 0.04), 24, 40)}px`);
      advice.setPosition(w * 0.5, title.y + title.height * 0.85 + unit * 0.03);

      const btnW = Phaser.Math.Clamp(Math.round(unit * 0.31), 220, 320);
      const btnH = Phaser.Math.Clamp(Math.round(unit * 0.10), 58, 86);
      confirmBg.setSize(btnW, btnH);
      confirmBg.setPosition(w * 0.5, panel.y + panel.height * 0.31);

      confirmText.setFontSize(`${Phaser.Math.Clamp(Math.round(btnH * 0.46), 26, 40)}px`);
      confirmText.setPosition(confirmBg.x, confirmBg.y + Math.round(btnH * 0.04));

      hint.setFontSize(`${Phaser.Math.Clamp(Math.round(unit * 0.022), 14, 20)}px`);
      hint.setPosition(w * 0.5, confirmBg.y + btnH * 0.72);
    };

    layout();
    this.scale.on('resize', layout);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', layout);
      this.input.keyboard?.off('keydown-ENTER', onEnter);
      this.input.keyboard?.off('keydown-SPACE', onEnter);
    });
  }
}
